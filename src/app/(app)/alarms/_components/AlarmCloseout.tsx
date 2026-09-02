"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { closeAlarmAction, reopenAlarmAction } from "../_actions";

const OUTCOMES: { value: string; label: string }[] = [
  { value: "FALSE_ALARM", label: "False alarm" },
  { value: "GENUINE", label: "Genuine — intruder / incident" },
  { value: "RESOLVED", label: "Resolved on site" },
  { value: "ESCALATED_TO_POLICE", label: "Escalated to police" },
  { value: "OTHER", label: "Other" },
];

/**
 * Close-out panel for an alarm event: record the outcome, when it was closed,
 * and any notes. Persists the AlarmEvent.outcome/closedAt/notes columns and
 * feeds the response-time reporting.
 */
export function AlarmCloseout({
  alarmId,
  initialOutcome,
  initialNotes,
  initialClosedAtLocal,
  nowLocal,
}: {
  alarmId: string;
  initialOutcome: string | null;
  initialNotes: string | null;
  /** Existing closedAt as a UK "YYYY-MM-DDTHH:MM" string, or "". */
  initialClosedAtLocal: string;
  /** Now as a UK datetime-local string, used as the default close time. */
  nowLocal: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const isClosed = Boolean(initialOutcome);
  const [outcome, setOutcome] = useState(initialOutcome ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [closedAt, setClosedAt] = useState(initialClosedAtLocal || nowLocal);

  function save() {
    if (!outcome) {
      toast.show({ tone: "error", message: "Choose an outcome first." });
      return;
    }
    start(async () => {
      const res = await closeAlarmAction(alarmId, {
        outcome,
        notes: notes.trim() || null,
        closedAt: closedAt || null,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Close-out saved." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  function reopen() {
    start(async () => {
      const res = await reopenAlarmAction(alarmId);
      if (res.ok) {
        toast.show({ tone: "success", message: "Alarm re-opened." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't re-open." });
      }
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          Close-out
        </h2>
        {isClosed && (
          <button
            type="button"
            onClick={reopen}
            disabled={pending}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            Re-open
          </button>
        )}
      </div>

      <div>
        <label className="label" htmlFor="alarm-outcome">
          Outcome
        </label>
        <select
          id="alarm-outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="input"
        >
          <option value="">— choose —</option>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="alarm-closedat">
          Closed at
        </label>
        <input
          id="alarm-closedat"
          type="datetime-local"
          value={closedAt}
          onChange={(e) => setClosedAt(e.target.value)}
          className="input"
        />
      </div>

      <div>
        <label className="label" htmlFor="alarm-notes">
          Notes
        </label>
        <textarea
          id="alarm-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="input"
          placeholder="What happened, who was informed, any follow-up…"
        />
      </div>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="btn-primary text-sm w-full"
      >
        {pending ? "Saving…" : isClosed ? "Update close-out" : "Save close-out"}
      </button>
    </div>
  );
}
