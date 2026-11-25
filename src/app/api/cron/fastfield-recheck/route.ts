import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import {
  checkShiftLinks,
  retryUnmatched,
  type RetrySummary,
  type ShiftCheckSummary,
} from "@/lib/fastfieldImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** An error's code or name only — never its message, which can quote a
 *  report's contents. */
const errCode = (e: unknown) =>
  (e as { code?: string })?.code ?? (e as Error)?.name ?? "error";

/**
 * Every 5 minutes, database only (no FastField calls):
 *  1. the shift check (checkShiftLinks): reports the robot put on a shift
 *     must fit it. Reports not checked yet, whose shift changed since, or
 *     judged under older rules are checked; one that doesn't fit moves to a
 *     shift at the site it fits, else comes off its shift — unless it has
 *     already gone to the client. Hand links are left alone. It also takes
 *     reports off activities that were deleted, and puts reports the robot
 *     took off back on a shift they now fit.
 *  2. try the waiting FastField reports again, those whose site has had work
 *     recorded or changed near their time first — so a report filed before
 *     its shift was logged links within minutes of the shift going in, not at
 *     the robot's next 4-hourly run.
 * Each step runs on its own: one failing doesn't stop the other, and the
 * reply carries its error code (never the message). Either step skips its
 * turn (`busy`) while another copy of the matcher is running.
 *
 * Bypassable in dev when CRON_SECRET isn't set.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const errors: { shiftCheck?: string; retry?: string } = {};
  let shifts: ShiftCheckSummary | null = null;
  try {
    shifts = await checkShiftLinks({ budgetMs: 15_000 });
  } catch (e) {
    errors.shiftCheck = errCode(e);
    console.error("FastField recheck: the shift check failed:", errors.shiftCheck);
  }
  let s: RetrySummary | null = null;
  try {
    s = await retryUnmatched({ budgetMs: 30_000 });
  } catch (e) {
    errors.retry = errCode(e);
    console.error("FastField recheck: the retry failed:", errors.retry);
  }
  const bothFailed = !shifts && !s;
  return NextResponse.json(
    {
      ok: !bothFailed,
      shiftCheck: shifts,
      checked: s?.checked ?? 0,
      linked: s?.linked ?? 0,
      created: s?.created ?? 0,
      notReached: s?.notReached ?? 0,
      failed: s?.failed ?? 0,
      ...(s?.busy ? { busy: true } : {}),
      ...(errors.shiftCheck || errors.retry ? { errors } : {}),
    },
    { status: bothFailed ? 500 : 200 },
  );
}
