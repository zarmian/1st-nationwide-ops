/**
 * SMS sending — httpsms (primary) with The SMS Works (automatic fallback).
 *
 * httpsms (https://httpsms.com) turns a dedicated Android phone + SIM into an
 * SMS gateway: we POST to its API, it pushes to the phone, and the phone sends
 * the text from your own mobile number (two-way — replies arrive on the phone,
 * and can be ingested later via a webhook).
 *
 * Env vars:
 *   HTTPSMS_API_KEY  — API key from https://httpsms.com/settings.
 *   HTTPSMS_FROM     — the phone's own number in E.164 (e.g. "+447700900123");
 *                      this is the "from" every text is sent as.
 *   SMS_WORKS_JWT    — The SMS Works customer JWT. Kept as a fallback so texts
 *                      still go out if the phone is offline / httpsms errors.
 *   SMS_WORKS_SENDER — optional sender ID for SMS Works (default "1NW").
 *
 * sendSms() uses httpsms when it's configured and falls back to SMS Works on
 * any failure. If only SMS Works is set (the previous state) behaviour is
 * unchanged. The exported surface (isSmsConfigured / normaliseE164 / sendSms)
 * is stable, so the notification queue, crons and every SMS use-case work as
 * before.
 */

const SMS_WORKS_ENDPOINT = "https://api.thesmsworks.co.uk/v1/message/send";
const HTTPSMS_ENDPOINT = "https://api.httpsms.com/v1/messages/send";

export type SendSmsInput = {
  to: string; // E.164, e.g. "+447700900123"
  body: string;
};

export type SendSmsResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

function httpsmsConfigured(): boolean {
  return Boolean(process.env.HTTPSMS_API_KEY && process.env.HTTPSMS_FROM);
}

function smsWorksConfigured(): boolean {
  return Boolean(process.env.SMS_WORKS_JWT);
}

export function isSmsConfigured(): boolean {
  return httpsmsConfigured() || smsWorksConfigured();
}

/**
 * Loose E.164 normaliser — accepts UK "07700900123" and drops formatting.
 * Returns null when the input clearly isn't a phone number.
 */
export function normaliseE164(input: string): string | null {
  const trimmed = input.trim().replace(/[\s()-]/g, "");
  if (!trimmed) return null;
  if (/^0\d{10}$/.test(trimmed)) return `+44${trimmed.slice(1)}`;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  return null;
}

/** httpsms — POST to its API; the registered phone does the actual sending. */
async function sendViaHttpsms({
  to,
  body,
}: SendSmsInput): Promise<SendSmsResult> {
  const apiKey = process.env.HTTPSMS_API_KEY;
  const from = process.env.HTTPSMS_FROM;
  if (!apiKey || !from) return { ok: false, error: "httpsms not configured" };

  // httpsms wants both numbers in E.164 with a leading "+". Our numbers are
  // already normalised; guard anyway.
  const toE164 = to.startsWith("+") ? to : normaliseE164(to) ?? to;

  let res: Response;
  try {
    res = await fetch(HTTPSMS_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: body.slice(0, 1600),
        from,
        to: toE164,
      }),
    });
  } catch (e: any) {
    return {
      ok: false,
      error: `httpsms network: ${e?.message ?? "fetch failed"}`,
    };
  }

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const meta =
      json?.message ?? json?.error ?? `${res.status} ${res.statusText}`;
    return { ok: false, error: `httpsms: ${meta}` };
  }
  const messageId = json?.data?.id ?? json?.id;
  if (!messageId) {
    return { ok: false, error: "httpsms: unexpected response shape" };
  }
  return { ok: true, messageId: String(messageId) };
}

/** The SMS Works — direct REST POST, no SDK. */
async function sendViaSmsWorks({
  to,
  body,
}: SendSmsInput): Promise<SendSmsResult> {
  const rawJwt = process.env.SMS_WORKS_JWT;
  if (!rawJwt) return { ok: false, error: "SMS Works not configured" };
  // Accept the token with or without a "JWT "/"Bearer " label — the API
  // wants the raw token as the Authorization header value.
  const jwt = rawJwt.replace(/^(JWT|Bearer)\s+/i, "").trim();
  const sender = process.env.SMS_WORKS_SENDER || "1NW";

  // SMS Works wants the destination in international format, digits only
  // (no leading +). Our numbers are already E.164.
  const destination = to.replace(/[^\d]/g, "");

  let res: Response;
  try {
    res = await fetch(SMS_WORKS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: jwt,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        destination,
        // Cap length defensively; SMS Works splits into segments and bills
        // per segment, so keep templates tight.
        content: body.slice(0, 1600),
      }),
    });
  } catch (e: any) {
    return { ok: false, error: `Network: ${e?.message ?? "fetch failed"}` };
  }

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const meta =
      json?.message ?? json?.error ?? `${res.status} ${res.statusText}`;
    return { ok: false, error: `SMS Works: ${meta}` };
  }
  const messageId = json?.messageid ?? json?.messageId ?? json?.id;
  if (!messageId) {
    return { ok: false, error: "SMS Works: unexpected response shape" };
  }
  return { ok: true, messageId: String(messageId) };
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const useHttpsms = httpsmsConfigured();
  const useSmsWorks = smsWorksConfigured();
  if (!useHttpsms && !useSmsWorks) {
    return { ok: false, error: "SMS not configured" };
  }

  if (useHttpsms) {
    const r = await sendViaHttpsms(input);
    // Succeeded, or nothing to fall back to → return as-is.
    if (r.ok || !useSmsWorks) return r;
    // httpsms failed (phone offline, rate-limited, …) but we have a
    // fallback provider — try it so the message still goes out.
    return sendViaSmsWorks(input);
  }

  return sendViaSmsWorks(input);
}
