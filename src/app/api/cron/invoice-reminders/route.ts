import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { sendDueReminders } from "@/lib/reminders";

/**
 * Daily overdue-invoice reminders (dunning).
 *
 * Runs at 08:00 UK (vercel.json). Emails the customer for each SENT invoice
 * that has crossed an overdue threshold (1 / 7 / 14 / 30 days) and hasn't yet
 * had that stage's reminder sent. No-op when email isn't configured.
 *
 * Cron-secret gated so it isn't externally callable; also usable manually for
 * testing (with the secret) since it's idempotent per stage.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await sendDueReminders();
  return NextResponse.json({ ok: true, ...result });
}
