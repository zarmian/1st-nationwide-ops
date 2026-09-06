"use server";

import { requireAdmin } from "@/lib/authz";
import { isSmsConfigured, normaliseE164, sendSms } from "@/lib/sms";

export type TestSmsState = {
  ok?: boolean;
  messageId?: string;
  sentTo?: string;
  error?: string;
  fieldErrors?: { to?: string; body?: string };
};

/**
 * Send a one-off SMS straight through the httpsms driver — bypassing the
 * notification queue — so an admin can prove the gateway works end to end.
 * Admin-only. Never stores anything; this is a diagnostic, not a domain event.
 */
export async function sendTestSms(
  _prev: TestSmsState,
  formData: FormData,
): Promise<TestSmsState> {
  await requireAdmin();

  const rawTo = String(formData.get("to") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  const fieldErrors: TestSmsState["fieldErrors"] = {};
  if (!rawTo) fieldErrors.to = "Enter a mobile number.";
  if (!body) fieldErrors.body = "Enter a message to send.";

  const to = rawTo ? normaliseE164(rawTo) : null;
  if (rawTo && !to) {
    fieldErrors.to = "That doesn't look like a UK/international mobile number.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  if (!isSmsConfigured()) {
    return {
      ok: false,
      error:
        "SMS isn't set up yet. Add HTTPSMS_API_KEY and HTTPSMS_FROM in Vercel, then redeploy.",
    };
  }

  const res = await sendSms({ to: to!, body });
  if (!res.ok) {
    return { ok: false, error: res.error, sentTo: to! };
  }
  return { ok: true, messageId: res.messageId, sentTo: to! };
}
