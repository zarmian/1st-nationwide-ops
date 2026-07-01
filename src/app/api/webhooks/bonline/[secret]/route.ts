import { NextResponse } from "next/server";
import {
  bonlineHealth,
  bonlineSecretOk,
  ingestBonline,
} from "@/lib/bonlineWebhook";

/**
 * Path-secret variant of the bOnline webhook, for webhook forms that reject
 * query strings:
 *   POST /api/webhooks/bonline/<BONLINE_WEBHOOK_SECRET>
 *
 * Same behaviour as the base route; the secret is the last path segment.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return bonlineHealth(new URL(req.url));
}

export async function POST(
  req: Request,
  { params }: { params: { secret: string } },
) {
  if (!bonlineSecretOk(params.secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return ingestBonline(req);
}
