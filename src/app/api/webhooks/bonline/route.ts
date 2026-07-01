import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseBonlineCall } from "@/lib/bonline";
import { notifyMissedCall } from "@/lib/notifications";

/**
 * Inbound webhook for bOnline call events.
 *
 * bOnline is configured to POST here on call events. We ALWAYS store the raw
 * payload (so the parser in @/lib/bonline can be tuned from real data), map
 * best-effort normalised fields for the call log, and — when a call is
 * detected as missed — queue an SMS alert to dispatch / on-call staff (24/7).
 *
 * Security: the request must carry the shared secret (BONLINE_WEBHOOK_SECRET)
 * either as `?key=` or an `x-webhook-secret` header — set the same value in
 * bOnline's webhook config. Without the env var set, the endpoint refuses
 * everything (fail closed) so it can't be abused before it's configured.
 *
 * We return 200 even when we can't parse the body (as long as the secret is
 * valid) so bOnline doesn't retry-storm; the raw row is still saved for us
 * to inspect.
 */

export const dynamic = "force-dynamic";

function authorised(req: Request, url: URL): boolean {
  const secret = process.env.BONLINE_WEBHOOK_SECRET;
  if (!secret) return false; // fail closed until configured
  const fromQuery = url.searchParams.get("key");
  const fromHeader = req.headers.get("x-webhook-secret");
  return fromQuery === secret || fromHeader === secret;
}

async function readBody(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) return await req.json();
    if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const form = await req.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : String(v);
      return obj;
    }
    // Unknown content type — try JSON, fall back to raw text.
    const text = await req.text();
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!authorised(req, url)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const payload = await readBody(req);
  const parsed = parseBonlineCall(payload);

  // De-dupe on the provider's own id when present: repeated deliveries of the
  // same call update the stored row instead of creating (and re-alerting on)
  // a duplicate.
  const existing = parsed.externalId
    ? await prisma.callEvent.findFirst({
        where: { provider: "bonline", externalId: parsed.externalId },
        select: { id: true, alerted: true },
      })
    : null;

  let callEventId: string;
  let alreadyAlerted = false;

  if (existing) {
    callEventId = existing.id;
    alreadyAlerted = existing.alerted;
    await prisma.callEvent.update({
      where: { id: existing.id },
      data: {
        direction: parsed.direction,
        status: parsed.status,
        rawStatus: parsed.rawStatus,
        fromNumber: parsed.fromNumber,
        toNumber: parsed.toNumber,
        durationSec: parsed.durationSec,
        missed: parsed.missed,
        occurredAt: parsed.occurredAt,
        payload: payload as any,
      },
    });
  } else {
    const created = await prisma.callEvent.create({
      data: {
        provider: "bonline",
        externalId: parsed.externalId,
        direction: parsed.direction,
        status: parsed.status,
        rawStatus: parsed.rawStatus,
        fromNumber: parsed.fromNumber,
        toNumber: parsed.toNumber,
        durationSec: parsed.durationSec,
        missed: parsed.missed,
        occurredAt: parsed.occurredAt,
        payload: payload as any,
      },
      select: { id: true },
    });
    callEventId = created.id;
  }

  // Missed → alert dispatch, once per call.
  let alerted = false;
  if (parsed.missed && !alreadyAlerted) {
    const queued = await notifyMissedCall(callEventId).catch((e) => {
      console.error("notifyMissedCall failed", e);
      return 0;
    });
    if (queued > 0) {
      await prisma.callEvent.update({
        where: { id: callEventId },
        data: { alerted: true },
      });
      alerted = true;
    }
  }

  return NextResponse.json({
    ok: true,
    id: callEventId,
    missed: parsed.missed,
    alerted,
  });
}
