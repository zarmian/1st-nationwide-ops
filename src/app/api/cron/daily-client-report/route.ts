import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { ukDayPlus } from "@/lib/dates";
import {
  getShurgardDelivery,
  alreadySentForDay,
  deliverShurgardReport,
} from "@/lib/reports/clientReportDelivery";

/**
 * Daily client report — automated send.
 *
 * Runs 07:00 UTC (vercel.json). Emails yesterday's Shurgard report (the
 * fully-completed UK day) to the configured recipient, but ONLY when the
 * Shurgard customer has `dailyReportOn = true` — off by default, so nothing
 * reaches a client until the business turns it on from the Daily report page.
 *
 * Idempotent: skips a day that already has a SENT record, so a retry or a
 * double-fire won't email the client twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Cover yesterday: the last complete UK day (unlock in the morning, lock at
  // night, overnight guarding all fall inside it).
  const day = ukDayPlus(new Date(), -1);

  const { shurgard, recipient } = await getShurgardDelivery();
  if (!shurgard) {
    return NextResponse.json({ ok: true, sent: false, reason: "no Shurgard customer" });
  }
  if (!shurgard.dailyReportOn) {
    return NextResponse.json({ ok: true, sent: false, reason: "auto-send off" });
  }
  if (!recipient) {
    return NextResponse.json({ ok: true, sent: false, reason: "no recipient set" });
  }
  if (await alreadySentForDay(day)) {
    return NextResponse.json({ ok: true, sent: false, reason: "already sent" });
  }

  const res = await deliverShurgardReport(day, { triggeredBy: "cron" });
  return res.ok
    ? NextResponse.json({ ok: true, sent: true, to: res.to })
    : NextResponse.json({ ok: true, sent: false, reason: res.reason });
}
