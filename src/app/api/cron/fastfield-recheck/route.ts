import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { checkShiftLinks, retryUnmatched } from "@/lib/fastfieldImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every 5 minutes, database only (no FastField calls):
 *  1. the shift check: every report on a shift must fit inside it. Reports
 *     not checked yet, or whose shift changed since, are checked; one that
 *     doesn't fit moves to a shift at the site it fits, else comes off its
 *     shift (checkShiftLinks). Its first passes cover every report ever put
 *     on a shift.
 *  2. try the waiting FastField reports again, those whose site has had work
 *     recorded or changed near their time first — so a report filed before
 *     its shift was logged links within minutes of the shift going in, not at
 *     the robot's next 4-hourly run.
 *
 * Bypassable in dev when CRON_SECRET isn't set.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const shifts = await checkShiftLinks({ budgetMs: 15_000 });
  const s = await retryUnmatched({ budgetMs: 30_000 });
  return NextResponse.json({
    ok: true,
    shiftCheck: shifts,
    checked: s.checked,
    linked: s.linked,
    created: s.created,
    notReached: s.notReached,
    failed: s.failed,
  });
}
