"use client";

import { useState } from "react";
import { sendShiftLinkSms } from "../_actions";

/**
 * Officer link panel on the shift detail page: the copyable /duty/<token>
 * URL plus a one-tap "Send via SMS". Shown while the shift is still open;
 * once completed the link is read-only history.
 */
export function ShiftLinkCard({
  shiftId,
  url,
  linkPhone,
}: {
  shiftId: string;
  url: string;
  linkPhone: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setResult({ ok: false, text: "Couldn't copy — select and copy manually." });
    }
  }

  async function send() {
    setSending(true);
    setResult(null);
    const res = await sendShiftLinkSms(shiftId);
    setSending(false);
    setResult({
      ok: res.ok,
      text: res.ok
        ? `Sent to ${linkPhone ?? "the officer"}.`
        : res.error ?? "Couldn't send.",
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-brand-navy">Officer link</h2>
        <p className="text-xs text-slate-500">
          Opens only this shift — no login, no other access. Send it to the
          officer to start, check in and end on site.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="input text-xs flex-1 font-mono"
        />
        <button type="button" onClick={copy} className="btn-secondary text-sm whitespace-nowrap">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="btn-primary text-sm"
        >
          {sending ? "Sending…" : "Send via SMS"}
        </button>
        <span className="text-xs text-slate-500">
          {linkPhone ? `Texts ${linkPhone}` : "No mobile on file — add one via Edit"}
        </span>
      </div>

      {result && (
        <p
          className={
            result.ok ? "text-xs text-brand-navy" : "text-xs text-red-600"
          }
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
