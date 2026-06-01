import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { materializePatrolVisits } from "@/lib/scheduleSync";

/**
 * Daily Vercel-cron entry point. Delegates to lib/scheduleSync.
 *
 * Default: today + tomorrow in UK terms. With ?date=YYYY-MM-DD it does
 * just that one day for back-fills.
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

  return NextResponse.json({ ok: true, days });
}
