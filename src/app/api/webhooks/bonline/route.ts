import { NextResponse } from "next/server";
import {
  bonlineHealth,
  bonlineSecretOk,
  ingestBonline,
} from "@/lib/bonlineWebhook";

/**
 * bOnline call webhook.
 *
 *   GET  → reachability / verification check (200, echoes a challenge param).
 *   POST → call event. Secret via `?key=` or `x-webhook-secret` header.
 *          (A clean path form also works: /api/webhooks/bonline/<secret>.)
 *
 * Always stores the raw payload; on a missed call, alerts dispatch by SMS.
 * See @/lib/bonlineWebhook.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return bonlineHealth(new URL(req.url));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("key") ?? req.headers.get("x-webhook-secret");
  if (!bonlineSecretOk(provided)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return ingestBonline(req);
}
