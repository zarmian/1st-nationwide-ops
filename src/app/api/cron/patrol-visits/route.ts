import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { materializePatrolVisits } from "@/lib/scheduleSync";
import { dedupePatrolVisits } from "@/lib/patrolDedup";

/**
 * Daily Vercel-cron entry point. Delegates to lib/scheduleSync.
 *
 * Default: today + tomorrow in UK terms. With ?date=YYYY-MM-DD it does
 * just that one day for back-fills.
 *
 * After materialising, auto-cleans any duplicate patrols (same site, exact
 * time and kind) so no manual step is needed — keeps one per slot, cancelling
 * only not-yet-started extras.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const anchor = dateParam ? new Date(dateParam) : new Date();
  if (isNaN(anchor.getTime())) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }

  const days = await materializePatrolVisits({
    anchor,
    offsets: dateParam ? [0] : [0, 1],
  });

  // System-run cleanup (no user) of any duplicate visits.
  const dedupe = await dedupePatrolVisits().catch((e) => {
    console.error("auto dedupePatrolVisits failed", e);
    return { groups: 0, cancelled: 0 };
  });

  return NextResponse.json({ ok: true, days, dedupe });
}
