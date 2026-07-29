import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { isTelegramConfigured } from "@/lib/telegram";
import { dayRundownMessage } from "@/lib/dayActivities";
import { broadcastToLinkedStaff } from "@/lib/telegramNotify";

/**
 * Morning brief — sends today's schedule to every linked ADMIN/DISPATCHER.
 * Vercel cron runs in UTC; scheduled for 07:00 UTC (≈ 7–8am UK depending on
 * DST). No-op when Telegram isn't configured.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: true, skipped: "telegram not configured" });
  }
  const body = await dayRundownMessage("today");
  const sent = await broadcastToLinkedStaff(
    `🌅 <b>Morning brief</b>\n\n${body}`,
  );
  return NextResponse.json({ ok: true, sent });
}
