import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import {
  notifyShiftCheckOverdue,
  notifyOfficerNoShow,
} from "@/lib/notifications";
import { alertPartnerUpdateDueTelegram } from "@/lib/telegramNotify";

/**
 * 15-min sweep that does three things:
 *
 *   1. For PENDING shifts whose `scheduledStartsAt + graceMinutes` is in
 *      the past, flip status to MISSED. Catches shifts the officer never
 *      started.
 *   2. For IN_PROGRESS shifts, compare the most recent SHIFT_CHECK
 *      submission against `checkIntervalMin + graceMinutes`. If overdue,
 *      queue a notification — de-duped by checking whether a
 *      SHIFT_CHECK_OVERDUE notification already exists newer than the
 *      latest check submission.
 *   3. For jobs handed to a partner (Nexus etc.) that are still open,
 *      remind dispatch every ~15 min to chase the partner for a status —
 *      paced by `Job.lastPartnerChaseAt`.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const now = new Date();

  // ── 1. PENDING → MISSED ─────────────────────────────────────────────────
  // Pull every PENDING shift whose scheduled start has already passed; the
  // grace check is done in JS because graceMinutes varies per row.
  const pending = await prisma.shift.findMany({
    where: { status: "PENDING", scheduledStartsAt: { lt: now } },
    select: { id: true, scheduledStartsAt: true, graceMinutes: true },
  });
  let markedMissed = 0;
  for (const s of pending) {
    const cutoff = s.scheduledStartsAt.getTime() + s.graceMinutes * 60_000;
    if (now.getTime() < cutoff) continue;
    // Alert the office *before* flipping status so a notification failure
    // leaves the shift PENDING and the next cron run retries. After the status
    // flips to MISSED, the shift drops out of this query. notifyOfficerNoShow
    // dedupes per entity and sends over whichever channels are configured
    // (Telegram / SMS), so re-running the cron is safe.
    await notifyOfficerNoShow({ entity: "Shift", entityId: s.id }).catch((e) =>
      console.error("notifyOfficerNoShow (shift) failed", e),
    );
    await prisma.shift.update({
      where: { id: s.id },
      data: { status: "MISSED" },
    });
    markedMissed++;
  }

  // ── 1b. Late jobs → SMS dispatcher ──────────────────────────────────────
  // Same idea as the shift no-show: if an APPROVED / SUBMITTED job is
  // 15+ min past its scheduled start and the officer hasn't clocked
  // in (`startedAt` null), text dispatch. Notification dedupes so the
  // alert only goes once even if the situation persists.
  const lateJobs = await prisma.job.findMany({
    where: {
      status: { in: ["APPROVED", "SUBMITTED"] },
      assignedToUserId: { not: null },
      startedAt: null,
      scheduledFor: {
        not: null,
        lt: new Date(now.getTime() - 15 * 60_000),
      },
    },
    select: { id: true },
    take: 100,
  });
  let jobNoShowQueued = 0;
  for (const j of lateJobs) {
    // notifyOfficerNoShow dedupes per job across channels and sends Telegram
    // and/or SMS per the routing settings, so it alerts once per job.
    const n = await notifyOfficerNoShow({
      entity: "Job",
      entityId: j.id,
    }).catch((e) => {
      console.error("notifyOfficerNoShow (job) failed", e);
      return 0;
    });
    jobNoShowQueued += n;
  }

  // ── 2. IN_PROGRESS overdue check-ins ────────────────────────────────────
  const shifts = await prisma.shift.findMany({
    where: { status: "IN_PROGRESS" },
    select: {
      id: true,
      actualStartedAt: true,
      checkIntervalMin: true,
      graceMinutes: true,
      formSubmissions: {
        where: { form: "SHIFT_CHECK" },
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: { submittedAt: true },
      },
    },
  });

  const nowMs = now.getTime();
  let flagged = 0;

  for (const s of shifts) {
    const last = s.formSubmissions[0]?.submittedAt ?? s.actualStartedAt;
    if (!last) continue;
    const dueAtMs =
      last.getTime() + (s.checkIntervalMin + s.graceMinutes) * 60_000;
    if (nowMs < dueAtMs) continue;

    // Don't spam: only queue if the most recent overdue notification for
    // this shift predates the most recent check (or there is no overdue
    // notification yet for this overdue window).
    const recentNotif = await prisma.notification.findFirst({
      where: {
        eventEntity: "Shift",
        eventEntityId: s.id,
        kind: "SHIFT_CHECK_OVERDUE",
        createdAt: { gt: last },
      },
      select: { id: true },
    });
    if (recentNotif) continue;

    const queued = await notifyShiftCheckOverdue(s.id).catch((e) => {
      console.error("notifyShiftCheckOverdue failed", e);
      return 0;
    });
    // notifyShiftCheckOverdue also sends Telegram inline to linked dispatch.
    // When no WhatsApp/SMS rows are queued (e.g. Telegram-only), it returns 0,
    // so the recentNotif gate above would re-broadcast every sweep — drop a
    // SKIPPED marker to hold it to once per overdue window. (When queued > 0 the
    // PENDING queue rows serve as the marker.)
    if (queued === 0) {
      await prisma.notification
        .create({
          data: {
            kind: "SHIFT_CHECK_OVERDUE",
            channel: "WHATSAPP",
            status: "SKIPPED",
            templateName: "shift_check_overdue",
            bodyPreview: "Telegram-only overdue check-in marker",
            eventEntity: "Shift",
            eventEntityId: s.id,
          },
        })
        .catch((e) => console.error("overdue dedup marker failed", e));
    }
    flagged++;
  }

  // ── 3. Partner hand-offs awaiting an update ─────────────────────────────
  // Jobs we've passed to a partner (Nexus etc.) have no automatic completion:
  // their officer uses the partner's own app, not ours. Nudge dispatch every
  // ~15 min to pull a status, until the job is closed / cancelled / completed
  // or the partner's report reference is logged. `lastPartnerChaseAt` (stamped
  // below) both dedupes within a run and paces the cadence across runs — a
  // 14-min floor so the */15 cron always clears it.
  const chaseCutoff = new Date(nowMs - 14 * 60_000);
  const partnerJobs = await prisma.job.findMany({
    where: {
      handledByPartnerId: { not: null },
      status: {
        in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING"],
      },
      completedAt: null,
      partnerReportRef: null,
      AND: [
        { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
        {
          OR: [
            { lastPartnerChaseAt: null },
            { lastPartnerChaseAt: { lte: chaseCutoff } },
          ],
        },
      ],
    },
    select: { id: true },
    take: 100,
  });
  let partnerChased = 0;
  for (const j of partnerJobs) {
    await alertPartnerUpdateDueTelegram(j.id).catch((e) =>
      console.error("alertPartnerUpdateDueTelegram failed", e),
    );
    // Stamp regardless of Telegram delivery so the cadence holds (and we don't
    // re-hammer broadcastToLinkedStaff) even when nobody's linked yet.
    await prisma.job
      .update({ where: { id: j.id }, data: { lastPartnerChaseAt: now } })
      .catch((e) => console.error("lastPartnerChaseAt update failed", e));
    partnerChased++;
  }

  return NextResponse.json({
    ok: true,
    pendingScanned: pending.length,
    markedMissed,
    inProgressScanned: shifts.length,
    flagged,
    lateJobsScanned: lateJobs.length,
    jobNoShowQueued,
    partnerChased,
  });
}
