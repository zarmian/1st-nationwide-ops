import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseBonlineCall } from "@/lib/bonline";
import { notifyMissedCall } from "@/lib/notifications";
import { alertMissedCallTelegram } from "@/lib/telegramNotify";

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
 * Store the call event (raw payload always kept) and, when it's a missed
 * call, alert dispatch by SMS — once per call. Assumes the caller has
 * already checked the secret.
 */
export async function ingestBonline(req: Request): Promise<NextResponse> {
  const payload = await readBody(req);
  const parsed = parseBonlineCall(payload);

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

  let alerted = false;
  if (parsed.missed && !alreadyAlerted) {
    const queued = await notifyMissedCall(callEventId).catch((e) => {
      console.error("notifyMissedCall failed", e);
      return 0;
    });
    // Telegram alert to any linked dispatch/admin — independent of SMS
    // recipients, so a Telegram-only team still gets the heads-up.
    const tg = await alertMissedCallTelegram(callEventId).catch((e) => {
      console.error("alertMissedCallTelegram failed", e);
      return 0;
    });
    if (queued > 0 || tg > 0) {
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
