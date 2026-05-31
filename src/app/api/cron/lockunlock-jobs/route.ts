import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { materializeLockUnlockJobs } from "@/lib/scheduleSync";

/**
 * Daily Vercel-cron entry point. Delegates to lib/scheduleSync for the
 * actual materialisation logic so the same code path can also be invoked
 * by the dispatcher's "Sync schedules" button.
 *
 * Default: today + tomorrow in UK terms (gives dispatch a 1-day-ahead
 * planning view). With ?date=YYYY-MM-DD it does just that one day, so an
 * operator can back-fill a specific date without spilling into tomorrow.
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

  const days = await materializeLockUnlockJobs({
    anchor,
    offsets: dateParam ? [0] : [0, 1],
  });

  return NextResponse.json({ ok: true, days });
}
