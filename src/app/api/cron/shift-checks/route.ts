import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { notifyShiftCheckOverdue } from "@/lib/notifications";

/**
 * Hourly sweep for overdue shift check-ins. For every IN_PROGRESS shift,
 * compare the most recent SHIFT_CHECK submission against
 * `checkIntervalMin + graceMinutes`. If overdue, queue a notification —
 * but only once per overdue window (we de-dupe by checking whether a
 * SHIFT_CHECK_OVERDUE notification already exists newer than the latest
 * check submission).
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

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

  const now = Date.now();
  let flagged = 0;

  for (const s of shifts) {
    const last = s.formSubmissions[0]?.submittedAt ?? s.actualStartedAt;
    if (!last) continue;
    const dueAtMs =
      last.getTime() + (s.checkIntervalMin + s.graceMinutes) * 60_000;
    if (now < dueAtMs) continue;

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

  return NextResponse.json({ ok: true, scanned: shifts.length, flagged });
}
