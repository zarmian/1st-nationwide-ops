import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";

/**
 * Hourly status sweep:
 * - PENDING + scheduledAt + 1h ago → LATE
 * - PENDING/LATE/IN_PROGRESS + scheduledAt + 24h ago → MISSED
 *
 * Bypassable in dev when CRON_SECRET isn't set.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const now = new Date();
  const lateCutoff = new Date(now.getTime() - 60 * 60 * 1000);
  const missedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [late, missed] = await prisma.$transaction([
    prisma.patrolVisit.updateMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: lateCutoff, gt: missedCutoff },
      },
      data: { status: "LATE" },
    }),
    prisma.patrolVisit.updateMany({
      where: {
        status: { in: ["PENDING", "LATE", "IN_PROGRESS"] },
        scheduledAt: { lte: missedCutoff },
      },
      data: { status: "MISSED" },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    flippedToLate: late.count,
    flippedToMissed: missed.count,
  });
}
