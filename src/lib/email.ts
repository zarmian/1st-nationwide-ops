/**
 * Transactional email via Resend (https://resend.com) — direct REST POST, no
 * SDK. Currently used to send invoice PDFs to customers.
 *
 * Required env vars to actually send:
 *   RESEND_API_KEY  — your Resend API key (starts "re_"). If unset,
 *                     isEmailConfigured() returns false and sendEmail() is a
 *                     no-op that returns a clear "not configured" error rather
 *                     than throwing — mirrors lib/sms.ts and lib/whatsapp.ts.
 *   EMAIL_FROM      — the verified sender, e.g.
 *                     "1st Nationwide <invoices@1stnationwide.co.uk>". Must be
 *                     on a domain verified in Resend or the send is rejected.
 *                     Falls back to Resend's shared test sender so nothing
 *                     crashes before the domain is set up.
 *
 * Keep the exported surface small (isEmailConfigured / sendEmail) so callers
 * don't couple to Resend specifics.
 */

const ENDPOINT = "https://api.resend.com/emails";

export type EmailAttachment = {
  filename: string;
  /** Raw bytes — base64-encoded before sending. */
  content: Buffer;
};

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  /** HTML body. */
  html: string;
  /** Optional plain-text fallback. */
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email not configured (RESEND_API_KEY unset)" };

  // Resend requires a verified sender; onboarding@resend.dev works before the
  // customer's own domain is verified, so the flow is testable end-to-end.
  const from = process.env.EMAIL_FROM || "1st Nationwide Ops <onboarding@resend.dev>";

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.text) body.text = input.text;
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.attachments?.length) {
    body.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    }));
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, error: `Network: ${e?.message ?? "fetch failed"}` };
  }

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const meta =
      json?.message ?? json?.error?.message ?? `${res.status} ${res.statusText}`;
    return { ok: false, error: `Resend: ${meta}` };
  }
  const id = json?.id;
  if (!id) return { ok: false, error: "Resend: unexpected response shape" };
  return { ok: true, id: String(id) };
}
