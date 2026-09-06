import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { drainQueue } from "@/lib/notifications";

/**
 * Drains pending SMS notifications via httpsms. Runs every minute.
 *
 * Mirrors the WhatsApp cron — same queue table, different channel
 * filter. If httpsms isn't configured, drainQueue marks rows
 * SKIPPED with a clear reason so they don't accumulate.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await drainQueue("SMS");
  return NextResponse.json({ ok: true, ...result });
}
