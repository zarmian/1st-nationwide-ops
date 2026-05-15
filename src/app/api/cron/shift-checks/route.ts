import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { notifyShiftCheckOverdue } from "@/lib/notifications";

/**
 * 15-min sweep that does two things:
 *
 *   1. For PENDING shifts whose `scheduledStartsAt + graceMinutes` is in
 *      the past, flip status to MISSED. Catches shifts the officer never
 *      started.
 *   2. For IN_PROGRESS shifts, compare the most recent SHIFT_CHECK
 *      submission against `checkIntervalMin + graceMinutes`. If overdue,
 *      queue a notification — de-duped by checking whether a
 *      SHIFT_CHECK_OVERDUE notification already exists newer than the
 *      latest check submission.
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
    await prisma.shift.update({
      where: { id: s.id },
      data: { status: "MISSED" },
    });
    markedMissed++;
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

    await notifyShiftCheckOverdue(s.id).catch((e) =>
      console.error("notifyShiftCheckOverdue failed", e),
    );
    flagged++;
  }

  return NextResponse.json({
    ok: true,
    pendingScanned: pending.length,
    markedMissed,
    inProgressScanned: shifts.length,
    flagged,
  });
}
