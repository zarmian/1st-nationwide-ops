import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { retryUnmatched } from "@/lib/fastfieldImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every 5 minutes: try the waiting FastField reports again, those whose site
 * has had work recorded or changed near their time first — so a report filed
 * before its shift was logged links within minutes of the shift going in,
 * not at the robot's next 4-hourly run. Database only; no FastField calls.
 *
 * Bypassable in dev when CRON_SECRET isn't set.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const s = await retryUnmatched({ budgetMs: 45_000 });
  return NextResponse.json({
    ok: true,
    checked: s.checked,
    linked: s.linked,
    created: s.created,
    notReached: s.notReached,
    failed: s.failed,
  });
}
