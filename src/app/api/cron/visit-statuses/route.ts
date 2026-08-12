import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { notifyVisitLateOrMissed } from "@/lib/notifications";

/**
 * Hourly status sweep for OUR patrol visits:
 * - PENDING + scheduledAt + 1h ago → LATE
 * - PENDING/LATE/IN_PROGRESS + scheduledAt + 24h ago → MISSED
 *
 * Partner-handled visits (handledByPartnerId set) are excluded — the partner
 * records them in their own app, so we get no attendance signal and must not
 * mark them late/missed or fire a missed-visit alert.
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

  // Find which visits will flip BEFORE updating, so we can notify each.
  const toLate = await prisma.patrolVisit.findMany({
    where: {
      status: "PENDING",
      handledByPartnerId: null,
      scheduledAt: { lte: lateCutoff, gt: missedCutoff },
    },
    select: { id: true },
  });
  const toMissed = await prisma.patrolVisit.findMany({
    where: {
      status: { in: ["PENDING", "LATE", "IN_PROGRESS"] },
      handledByPartnerId: null,
      scheduledAt: { lte: missedCutoff },
    },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.patrolVisit.updateMany({
      where: {
        status: "PENDING",
        handledByPartnerId: null,
        scheduledAt: { lte: lateCutoff, gt: missedCutoff },
      },
      data: { status: "LATE" },
    }),
    prisma.patrolVisit.updateMany({
      where: {
        status: { in: ["PENDING", "LATE", "IN_PROGRESS"] },
        handledByPartnerId: null,
        scheduledAt: { lte: missedCutoff },
      },
      data: { status: "MISSED" },
    }),
  ]);

  // Queue notifications best-effort (don't fail the cron if any error).
  for (const v of toLate) {
    await notifyVisitLateOrMissed(v.id, "LATE").catch((e) =>
      console.error("notifyVisitLateOrMissed failed", e),
    );
  }
  for (const v of toMissed) {
    await notifyVisitLateOrMissed(v.id, "MISSED").catch((e) =>
      console.error("notifyVisitLateOrMissed failed", e),
    );
  }

  return NextResponse.json({
    ok: true,
    flippedToLate: toLate.length,
    flippedToMissed: toMissed.length,
  });
}
