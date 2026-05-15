/**
 * Meta WhatsApp Cloud API client.
 *
 * Sends template messages (the only kind allowed outside a 24-hour customer-
 * initiated session — which is always our case for outbound notifications).
 *
 * Required env vars to actually send:
 *   WHATSAPP_PHONE_ID     — the Phone Number ID from Meta Business
 *   WHATSAPP_ACCESS_TOKEN — permanent access token from your Meta App
 *
 * If either is unset, isWhatsAppConfigured() returns false. Callers should
 * still queue Notification rows — the cron drainer skips PENDING rows and
 * marks them SKIPPED with a clear reason rather than calling Meta.
 */

const API_VERSION = "v21.0";

export type SendTemplateInput = {
  to: string; // E.164, e.g. "+447700900123"
  templateName: string;
  language?: string; // BCP-47, default "en_GB"
  bodyParams?: string[]; // mapped to {{1}}, {{2}}, …
};

export type SendTemplateResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_ACCESS_TOKEN,
  );
}

export function normaliseE164(input: string): string | null {
  const trimmed = input.trim().replace(/[\s()-]/g, "");
  if (!trimmed) return null;
  // Accept both "07700900123" (UK local) and "+447700900123" — assume +44 if
  // a leading 0 with 10 digits.
  if (/^0\d{10}$/.test(trimmed)) {
    return `+44${trimmed.slice(1)}`;
  }
  // Strict E.164: leading +, country code can't start with 0, total 8-16
  // digits after the +.
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  return null;
}

export async function sendTemplate({
  to,
  templateName,
  language = "en_GB",
  bodyParams = [],
}: SendTemplateInput): Promise<SendTemplateResult> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    return { ok: false, error: "WhatsApp not configured" };
  }

  // E.164 in API expects no leading "+", just digits.
  const recipient = to.replace(/^\+/, "");

  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ]
      : [];

  const url = `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, error: `Network: ${e?.message ?? "fetch failed"}` };
  }

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const meta = json?.error?.message ?? `${res.status} ${res.statusText}`;
    return { ok: false, error: `Meta: ${meta}` };
  }
  const messageId = json?.messages?.[0]?.id;
  if (!messageId) {
    return { ok: false, error: "Meta: unexpected response shape" };
  }
  return { ok: true, messageId };
}
