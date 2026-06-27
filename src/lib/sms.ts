/**
 * Twilio SMS client.
 *
 * Direct REST POST — no Twilio SDK so the deploy bundle stays slim.
 * Required env vars to actually send:
 *   TWILIO_ACCOUNT_SID   — Account SID from Twilio console
 *   TWILIO_AUTH_TOKEN    — Auth token (or API key secret)
 *   TWILIO_FROM          — Twilio number in E.164, e.g. "+447700900123"
 *
 * If any are unset, isSmsConfigured() returns false. Callers should still
 * queue Notification rows — drainQueue marks SMS rows SKIPPED with a clear
 * reason while configuration is being set up.
 */

export type SendSmsInput = {
  to: string; // E.164, e.g. "+447700900123"
  body: string;
};

export type SendSmsResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM,
  );
}

/**
 * Loose E.164 normaliser shared with the WhatsApp driver — accepts UK
 * "07700900123" + drops formatting whitespace / brackets. Returns null
 * when the input clearly isn't a phone number.
 */
export function normaliseE164(input: string): string | null {
  const trimmed = input.trim().replace(/[\s()-]/g, "");
  if (!trimmed) return null;
  if (/^0\d{10}$/.test(trimmed)) return `+44${trimmed.slice(1)}`;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  return null;
}

export async function sendSms({ to, body }: SendSmsInput): Promise<SendSmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return { ok: false, error: "Twilio not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  // Hard cap at 1600 chars — Twilio rejects longer, and we'd rather
  // truncate than 400. Single SMS segment is 160 GSM-7 chars; over that
  // Twilio splits + charges per segment, so keep templates tight.
  form.set("Body", body.slice(0, 1600));

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (e: any) {
    return { ok: false, error: `Network: ${e?.message ?? "fetch failed"}` };
  }

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const meta = json?.message ?? `${res.status} ${res.statusText}`;
    return { ok: false, error: `Twilio: ${meta}` };
  }
  const messageId = json?.sid;
  if (!messageId) {
    return { ok: false, error: "Twilio: unexpected response shape" };
  }
  return { ok: true, messageId };
}
