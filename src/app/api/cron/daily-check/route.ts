import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { getDailyCheckSettings, runDailyCheck } from "@/lib/dailyCheck";

/**
 * Daily check — runs 06:30 UTC (vercel.json), after the 05:07 portal syncs.
 * Looks over everything since the last morning check (duplicates, missing
 * reports, FastField reports that don't fit, incidents Claude finds in the
 * reports, stale syncs) and emails the office. Switch off or change who gets
 * it on Admin → Daily check. See lib/dailyCheck.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const settings = await getDailyCheckSettings();
  if (!settings.enabled) {
    return NextResponse.json({ ok: true, ran: false, reason: "switched off" });
  }
  try {
    const res = await runDailyCheck({ trigger: "cron", email: true });
    return NextResponse.json({ ok: true, ran: true, counts: res.counts, emailed: res.emailed });
  } catch (e: any) {
    console.error("Daily check failed:", e?.code ?? e?.name ?? "error");
    return NextResponse.json({ ok: false, error: "Daily check failed" }, { status: 500 });
  }
}
