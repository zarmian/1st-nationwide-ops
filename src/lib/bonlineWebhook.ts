import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  parseBonlineCall,
  isBonlineLegShape,
  extractBonlineLegs,
  parseBonlineLeg,
  deriveCallFromLegs,
  isExternalNumber,
} from "@/lib/bonline";
import { notifyMissedCall } from "@/lib/notifications";

/**
 * Shared bOnline webhook logic, used by both URL shapes:
 *   POST /api/webhooks/bonline?key=SECRET      (or x-webhook-secret header)
 *   POST /api/webhooks/bonline/SECRET          (secret in the path — clean
 *                                               URL for webhook forms that
 *                                               reject query strings)
 */

/** Constant-ish secret compare against BONLINE_WEBHOOK_SECRET. Fail closed
 *  when the env var isn't set so the endpoint can't be abused pre-config. */
export function bonlineSecretOk(provided: string | null | undefined): boolean {
  const secret = process.env.BONLINE_WEBHOOK_SECRET;
  if (!secret) return false;
  return typeof provided === "string" && provided === secret;
}

/**
 * GET handler — lets a provider's "verify this URL" / reachability check
 * pass. Echoes a challenge param when present (common verification pattern);
 * otherwise returns a plain 200. No secret required: nothing sensitive is
 * returned or changed.
 */
export function bonlineHealth(url: URL): NextResponse {
  const challenge =
    url.searchParams.get("challenge") ??
    url.searchParams.get("hub.challenge") ??
    url.searchParams.get("verify");
  if (challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ ok: true, service: "bonline-webhook" });
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
      for (const [k, v] of form.entries()) {
        obj[k] = typeof v === "string" ? v : String(v);
      }
      return obj;
    }
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

/**
 * Store the call (raw payload always kept) and, when it's a missed call, alert
 * the office — once per call. Assumes the secret is already checked.
 *
 * bOnline pushes one webhook per call *leg* (grouped by `conversation_id`), so
 * for that shape we merge the legs into a single CallEvent and derive the
 * call-level outcome. Anything else falls back to the generic one-row handler.
 */
export async function ingestBonline(req: Request): Promise<NextResponse> {
  const payload = await readBody(req);
  if (isBonlineLegShape(payload)) {
    return ingestBonlineLeg(payload);
  }
  return ingestGenericCall(payload);
}

/**
 * Raise the missed-call alert once per CallEvent, flipping `alerted` only after
 * an alert is actually recorded (so an unconfigured channel retries later).
 * Returns whether the row is now considered alerted.
 */
async function alertMissedOnce(
  callEventId: string,
  alreadyAlerted: boolean,
): Promise<boolean> {
  if (alreadyAlerted) return true;
  await notifyMissedCall(callEventId).catch((e) => {
    console.error("notifyMissedCall failed", e);
    return 0;
  });
  const recorded = await prisma.notification.findFirst({
    where: {
      eventEntity: "CallEvent",
      eventEntityId: callEventId,
      kind: "MISSED_CALL",
      status: { notIn: ["FAILED"] },
    },
    select: { id: true },
  });
  if (!recorded) return false;
  await prisma.callEvent.update({
    where: { id: callEventId },
    data: { alerted: true },
  });
  return true;
}

/**
 * bOnline call-state webhook. Handles either shape — a single leg, or the whole
 * conversation as `{ legs: {…} }` — and merges into one CallEvent keyed by
 * conversation_id, re-deriving the call from all known legs each time.
 */
async function ingestBonlineLeg(payload: unknown): Promise<NextResponse> {
  const rawLegs = extractBonlineLegs(payload);
  if (rawLegs.length === 0) return ingestGenericCall(payload);

  const parsedIncoming = rawLegs.map(parseBonlineLeg);
  const key =
    parsedIncoming.map((l) => l.conversationId).find((c): c is string => !!c) ??
    parsedIncoming.map((l) => l.legId).find((c): c is string => !!c) ??
    null;
  if (!key) return ingestGenericCall(payload);

  const existing = await prisma.callEvent.findFirst({
    where: { provider: "bonline", externalId: key },
    select: { id: true, alerted: true, payload: true },
  });

  // Accumulate legs keyed by legId so a later state update for the same leg
  // replaces the earlier one; then re-derive the whole call from all legs.
  const legMap: Record<string, unknown> = {};
  const prevLegs = (existing?.payload as { legs?: unknown } | null)?.legs;
  if (prevLegs && typeof prevLegs === "object" && !Array.isArray(prevLegs)) {
    Object.assign(legMap, prevLegs as Record<string, unknown>);
  }
  rawLegs.forEach((raw, i) => {
    const l = parsedIncoming[i];
    const legKey = l.legId ?? `leg-${Object.keys(legMap).length + 1}`;
    legMap[legKey] = raw;
  });

  const d = deriveCallFromLegs(Object.values(legMap).map(parseBonlineLeg));
  const latest = parsedIncoming[parsedIncoming.length - 1];

  const data = {
    provider: "bonline",
    externalId: key,
    direction: d.direction,
    status: d.status,
    rawStatus: latest?.providerStatus ?? null,
    fromNumber: d.fromNumber,
    toNumber: d.toNumber,
    durationSec: d.durationSec,
    missed: d.missed,
    occurredAt: d.occurredAt,
    payload: { legs: legMap } as any,
  };

  let callEventId: string;
  let alreadyAlerted = false;
  if (existing) {
    callEventId = existing.id;
    alreadyAlerted = existing.alerted;
    await prisma.callEvent.update({ where: { id: existing.id }, data });
  } else {
    const created = await prisma.callEvent.create({
      data,
      select: { id: true },
    });
    callEventId = created.id;
  }

  // Only a genuinely missed *external* call raises an alert — never an
  // extension-to-extension internal miss.
  let alerted = alreadyAlerted;
  if (d.missed && isExternalNumber(d.fromNumber)) {
    alerted = await alertMissedOnce(callEventId, alreadyAlerted);
  }

  return NextResponse.json({
    ok: true,
    id: callEventId,
    conversationId: key,
    status: d.status,
    missed: d.missed,
    alerted,
  });
}

/** Generic one-shot call webhook (non-bOnline shapes): one row per call id. */
async function ingestGenericCall(payload: unknown): Promise<NextResponse> {
  const parsed = parseBonlineCall(payload);

  const existing = parsed.externalId
    ? await prisma.callEvent.findFirst({
        where: { provider: "bonline", externalId: parsed.externalId },
        select: { id: true, alerted: true },
      })
    : null;

  const data = {
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
  };

  let callEventId: string;
  let alreadyAlerted = false;
  if (existing) {
    callEventId = existing.id;
    alreadyAlerted = existing.alerted;
    await prisma.callEvent.update({ where: { id: existing.id }, data });
  } else {
    const created = await prisma.callEvent.create({
      data,
      select: { id: true },
    });
    callEventId = created.id;
  }

  let alerted = alreadyAlerted;
  if (parsed.missed) {
    alerted = await alertMissedOnce(callEventId, alreadyAlerted);
  }

  return NextResponse.json({
    ok: true,
    id: callEventId,
    missed: parsed.missed,
    alerted,
  });
}
