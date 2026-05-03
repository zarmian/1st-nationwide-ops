import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { drainQueue } from "@/lib/notifications";

/**
 * Drains pending WhatsApp notifications. Runs every minute (vercel.json).
 *
 * If WhatsApp env vars aren't set, drainQueue marks every PENDING row
 * SKIPPED — useful diagnostic so the admin queue doesn't fill up while
 * Meta setup is in progress.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await drainQueue();
  return NextResponse.json({ ok: true, ...result });
}
