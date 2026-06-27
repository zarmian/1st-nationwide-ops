import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { notifyShiftReminder, notifyJobReminder } from "@/lib/notifications";

/**
 * 5-min sweep that texts assigned officers about shifts + jobs starting
 * in the next 30-60 min. Each row gets a single reminder via the
 * idempotent queueSmsOnce path (Notification rows are unique per
 * Shift/Job id with kind=SHIFT_REMINDER / JOB_REMINDER).
 *
 * The 30-60 min window is wide enough that a 5-min cron will always
 * catch each upcoming row exactly once. Narrower windows risk missing
 * rows if a cron run is delayed; wider windows give officers too much
 * lead time.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const now = new Date();
  const from = new Date(now.getTime() + 30 * 60_000); // +30 min
  const to = new Date(now.getTime() + 60 * 60_000); //   +60 min

  const [shifts, jobs] = await Promise.all([
    prisma.shift.findMany({
      where: {
        status: "PENDING",
        officerId: { not: null },
        scheduledStartsAt: { gte: from, lte: to },
      },
      select: { id: true },
    }),
    prisma.job.findMany({
      where: {
        status: { in: ["APPROVED", "SUBMITTED"] },
        assignedToUserId: { not: null },
        scheduledFor: { gte: from, lte: to },
        startedAt: null,
      },
      select: { id: true },
    }),
  ]);

  let shiftQueued = 0;
  let jobQueued = 0;
  for (const s of shifts) {
    const n = await notifyShiftReminder(s.id).catch((e) => {
      console.error("notifyShiftReminder failed", e);
      return 0;
    });
    shiftQueued += n;
  }
  for (const j of jobs) {
    const n = await notifyJobReminder(j.id).catch((e) => {
      console.error("notifyJobReminder failed", e);
      return 0;
    });
    jobQueued += n;
  }

  return NextResponse.json({
    ok: true,
    shiftScanned: shifts.length,
    shiftQueued,
    jobScanned: jobs.length,
    jobQueued,
  });
}
