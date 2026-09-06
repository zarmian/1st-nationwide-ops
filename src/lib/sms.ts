/**
 * SMS sending — httpsms (https://httpsms.com).
 *
 * httpsms turns a dedicated Android phone + SIM into an SMS gateway: we POST
 * to its API, it pushes to the phone, and the phone sends the text from our
 * own mobile number. We only ever call the "send" endpoint here — this module
 * never reads or ingests inbound messages.
 *
 * Security note: the httpsms Android app reads ALL incoming SMS on the phone
 * it runs on (there's no send-only mode and no per-SIM / per-number filter),
 * so run it on a DEDICATED phone that holds ONLY the gateway SIM — no personal
 * SIM, no personal accounts. Then "reads all incoming SMS" is harmless.
 *
 * Env vars:
 *   HTTPSMS_API_KEY  — API key from https://httpsms.com/settings (or your
 *                      self-hosted instance).
 *   HTTPSMS_FROM     — the phone's own number in E.164 (e.g. "+447700900123");
 *                      this is the "from" every text is sent as.
 *   HTTPSMS_ENDPOINT — optional override of the API base send URL, e.g. for a
 *                      self-hosted server. Defaults to the hosted service.
 *
 * The exported surface (isSmsConfigured / normaliseE164 / sendSms) is stable,
 * so the notification queue, crons and every SMS use-case work unchanged.
 */

const DEFAULT_HTTPSMS_ENDPOINT = "https://api.httpsms.com/v1/messages/send";

export type SendSmsInput = {
  to: string; // E.164, e.g. "+447700900123"
  body: string;
};

export type SendSmsResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return Boolean(process.env.HTTPSMS_API_KEY && process.env.HTTPSMS_FROM);
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
export async function sendSms({
  to,
  body,
}: SendSmsInput): Promise<SendSmsResult> {
  const apiKey = process.env.HTTPSMS_API_KEY;
  const from = process.env.HTTPSMS_FROM;
  if (!apiKey || !from) {
    return {
      ok: false,
      error: "SMS not configured (HTTPSMS_API_KEY / HTTPSMS_FROM missing)",
    };
  }

  const endpoint = process.env.HTTPSMS_ENDPOINT || DEFAULT_HTTPSMS_ENDPOINT;

  // httpsms wants both numbers in E.164 with a leading "+". Our numbers are
  // already normalised; guard anyway.
  const toE164 = to.startsWith("+") ? to : normaliseE164(to) ?? to;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Cap length defensively; long texts are split into segments.
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
