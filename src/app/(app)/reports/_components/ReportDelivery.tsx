"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Send, Clock } from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  saveReportDeliveryAction,
  sendReportNowAction,
} from "../_actions";

export type RecentSendView = {
  id: string;
  dateLabel: string;
  status: string; // SENT | FAILED | PENDING | CANCELLED
  to: string;
  whenLabel: string; // "Sent 09:05" / "Attempted 09:05"
  via: string; // "Automatic" | "Manual"
  failureReason: string | null;
};

const STATUS_CHIP: Record<string, string> = {
  SENT: "chip-green",
  FAILED: "chip-red",
  PENDING: "chip-amber",
  CANCELLED: "chip-slate",
};

/**
 * Delivery controls for the daily client report: an automatic-send toggle +
 * recipient, a "Send now" button for the day being viewed, and a short send
 * history. Admin-only actions (the server actions re-check the role).
 */
export function ReportDelivery({
  dayYmd,
  dayLabel,
  initialOn,
  initialRecipient,
  contactEmail,
  emailConfigured,
  recentSends,
}: {
  dayYmd: string;
  dayLabel: string;
  initialOn: boolean;
  initialRecipient: string;
  contactEmail: string | null;
  emailConfigured: boolean;
  recentSends: RecentSendView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [savePending, startSave] = useTransition();
  const [sendPending, startSend] = useTransition();

  const [on, setOn] = useState(initialOn);
  const [recipient, setRecipient] = useState(initialRecipient);

  const effectiveRecipient = recipient.trim() || contactEmail || "";

  function save() {
    startSave(async () => {
      const res = await saveReportDeliveryAction({
        on,
        recipient: recipient.trim() || null,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Delivery settings saved." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  function sendNow() {
    startSend(async () => {
      const res = await sendReportNowAction(dayYmd, recipient.trim() || null);
      if (res.ok) {
        toast.show({
          tone: "success",
          message: `Report sent to ${res.to}.`,
        });
        router.refresh();
      } else {
        toast.show({
          tone: "error",
          message: res.error ?? "Couldn't send the report.",
        });
      }
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start gap-2">
        <Mail size={18} className="text-brand-blue mt-0.5" aria-hidden />
        <div>
          <h2 className="font-semibold text-brand-navy">Email delivery</h2>
          <p className="text-xs text-slate-500">
            Send this report to the client — on demand, or automatically each
            morning.
          </p>
        </div>
      </div>

      {!emailConfigured && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          Email isn’t switched on yet. Set <code>RESEND_API_KEY</code> in Vercel
          and sends will start working — settings below are saved regardless.
        </div>
      )}

      <div className="space-y-2">
        <label className="label" htmlFor="report-recipient">
          Send to
        </label>
        <input
          id="report-recipient"
          type="email"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={contactEmail ?? "reports@shurgard.example"}
          className="input"
          autoComplete="off"
        />
        <p className="text-xs text-slate-500">
          {recipient.trim()
            ? "Overrides the Shurgard contact email."
            : contactEmail
              ? `Blank = the Shurgard contact email (${contactEmail}).`
              : "No Shurgard contact email on file — set an address here."}
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="checkbox mt-0.5"
        />
        <span>
          Email automatically every morning (07:00)
          <span className="block text-xs text-slate-500">
            Covers the previous day. Off until you turn it on, so nothing
            reaches the client by surprise.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={save}
          disabled={savePending}
          className="btn-secondary text-sm"
        >
          {savePending ? "Saving…" : "Save settings"}
        </button>
        <button
          type="button"
          onClick={sendNow}
          disabled={sendPending || !effectiveRecipient}
          className="btn-primary text-sm inline-flex items-center gap-1.5"
          title={
            effectiveRecipient
              ? `Send the ${dayLabel} report to ${effectiveRecipient}`
              : "Add a recipient first"
          }
        >
          <Send size={14} aria-hidden />
          {sendPending ? "Sending…" : "Send now"}
        </button>
      </div>

      {recentSends.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <Clock size={12} aria-hidden />
            Recent sends
          </h3>
          <ul className="space-y-2">
            {recentSends.map((s) => (
              <li key={s.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-brand-navy">{s.dateLabel}</span>
                  <span className={STATUS_CHIP[s.status] ?? "chip-slate"}>
                    {s.status.toLowerCase()}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {s.whenLabel} · {s.via} · {s.to}
                </div>
                {s.failureReason && (
                  <div className="text-xs text-red-600">{s.failureReason}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
