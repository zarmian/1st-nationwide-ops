/**
 * The SMS Works client (https://thesmsworks.co.uk).
 *
 * Direct REST POST — no SDK. Required env vars to actually send:
 *   SMS_WORKS_JWT     — the customer JWT from your SMS Works account
 *                       (Account → API keys → JWT). Long-lived.
 *   SMS_WORKS_SENDER  — optional sender ID shown to recipients. Alphanumeric
 *                       (max 11 chars, one-way) or a number. Defaults to
 *                       "1NW".
 *
 * If SMS_WORKS_JWT is unset, isSmsConfigured() returns false and the queue
 * drainer marks SMS rows SKIPPED with a clear reason instead of sending.
 *
 * We keep the exported surface (isSmsConfigured / normaliseE164 / sendSms)
 * identical to the previous Twilio driver, so the notification queue, crons
 * and every SMS use-case work unchanged.
 */

const ENDPOINT = "https://api.thesmsworks.co.uk/v1/message/send";

export type SendSmsInput = {
  to: string; // E.164, e.g. "+447700900123"
  body: string;
};

export type SendSmsResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMS_WORKS_JWT);
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

export async function sendSms({ to, body }: SendSmsInput): Promise<SendSmsResult> {
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
    res = await fetch(ENDPOINT, {
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
