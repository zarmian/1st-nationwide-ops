import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { shouldCreateVisitOn, defaultScheduledAt } from "@/lib/patrolDates";

/**
 * Daily creator: walks every active PatrolSchedule and creates a PatrolVisit
 * for today's date when the schedule's frequency rule matches. Idempotent —
 * skips when a visit already exists for the same (schedule, day).
 *
 * Vercel Cron hits this once a day. Can also be invoked manually for a
 * specific date with ?date=YYYY-MM-DD (admin-only by virtue of the
 * Authorization: Bearer CRON_SECRET header).
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const target = dateParam ? new Date(dateParam) : new Date();
  if (isNaN(target.getTime())) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }
  // Normalise to start-of-day UTC for the day-window comparisons.
  target.setUTCHours(0, 0, 0, 0);

  const schedules = await prisma.patrolSchedule.findMany({
    where: { active: true },
  });

  let created = 0;
  let skipped = 0;
  for (const s of schedules) {
    const due = shouldCreateVisitOn(s, target);
    if (!due) continue;

    const dayStart = new Date(target);
    const dayEnd = new Date(target);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const existing = await prisma.patrolVisit.findFirst({
      where: {
        siteId: s.siteId,
        patrolScheduleId: s.id,
        scheduledAt: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.patrolVisit.create({
      data: {
        siteId: s.siteId,
        patrolScheduleId: s.id,
        officerId: s.assignedOfficerId,
        scheduledAt: defaultScheduledAt(target, s.kind),
        status: "PENDING",
      },
    });
    created++;
  }

  return NextResponse.json({
    ok: true,
    date: target.toISOString().slice(0, 10),
    created,
    skipped,
    schedulesChecked: schedules.length,
  });
}
