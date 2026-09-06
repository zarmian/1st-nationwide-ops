import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { notifyOfficerPaySummary } from "@/lib/notifications";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

/**
 * Month-end officer pay summary SMS.
 *
 * Runs at 09:00 UK on the 1st of each month (vercel.json). Sums each
 * active officer's prior-month pay across PatrolVisit.paidAmount,
 * Job.paidAmount, and Shift.paidAmount; texts those with phone numbers
 * a one-line summary.
 *
 * Idempotent per officer-month — the Notification eventEntityId is
 * `<officerId>:<YYYY-MM>`, so re-running the cron in-month won't re-send.
 *
 * `?force=YYYY-MM` overrides which month to sum — useful for admin
 * testing without waiting for the calendar. Still gated on the cron
 * secret so it's not externally callable.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force");

  // Default: prior calendar month. 1st-of-month cron runs sum what just
  // ended — e.g. running on 2026-07-01 sums June 2026.
  const now = new Date();
  let monthStart: Date;
  let monthEnd: Date;
  let monthLabel: string;
  if (force && /^\d{4}-\d{2}$/.test(force)) {
    const [y, m] = force.split("-").map(Number);
    monthStart = new Date(y, m - 1, 1);
    monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
    monthLabel = monthStart.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      month: "long",
      year: "numeric",
    });
  } else {
    monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    monthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    monthLabel = monthStart.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      month: "long",
      year: "numeric",
    });
  }

  const officers = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["OFFICER", "DISPATCHER"] },
      NOT: { phone: null },
    },
    select: { id: true, name: true },
  });

  let queued = 0;
  for (const o of officers) {
    const [v, j, s] = await Promise.all([
      prisma.patrolVisit.aggregate({
        where: {
          officerId: o.id,
          status: "COMPLETED",
          ...visitScheduledRange(monthStart, monthEnd),
        },
        _sum: { paidAmount: true },
        _count: { _all: true },
      }),
      prisma.job.aggregate({
        where: {
          assignedToUserId: o.id,
          status: { not: "CANCELLED" },
          completedAt: { not: null },
          ...jobScheduledRange(monthStart, monthEnd),
        },
        _sum: { paidAmount: true },
        _count: { _all: true },
      }),
      prisma.shift.aggregate({
        where: {
          officerId: o.id,
          status: "COMPLETED",
          ...shiftScheduledRange(monthStart, monthEnd),
        },
        _sum: { paidAmount: true },
        _count: { _all: true },
      }),
    ]);
    const activities = v._count._all + j._count._all + s._count._all;
    const totalPay =
      Number(v._sum.paidAmount ?? 0) +
      Number(j._sum.paidAmount ?? 0) +
      Number(s._sum.paidAmount ?? 0);
    if (activities === 0 && totalPay === 0) continue;
    const n = await notifyOfficerPaySummary({
      officerId: o.id,
      monthLabel,
      activities,
      totalPay,
    }).catch((e) => {
      console.error("notifyOfficerPaySummary failed", e);
      return 0;
    });
    queued += n;
  }

  return NextResponse.json({
    ok: true,
    officerScanned: officers.length,
    queued,
    monthLabel,
  });
}
