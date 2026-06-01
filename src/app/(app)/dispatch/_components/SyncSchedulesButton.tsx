"use client";

import { useState, useTransition } from "react";
import { syncSchedulesNow } from "../_actions";

/**
 * Kicks the daily schedule materialiser by hand. Same code path as the
 * Vercel cron — so if the cron missed today (or you just added a new
 * recurring schedule) you can self-heal with one click instead of
 * waiting for tomorrow morning.
 */
export function SyncSchedulesButton() {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function onClick() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const r = await syncSchedulesNow();
        const parts: string[] = [];
        if (r.jobsCreated) parts.push(`${r.jobsCreated} lock/unlock job${r.jobsCreated === 1 ? "" : "s"}`);
        if (r.visitsCreated) parts.push(`${r.visitsCreated} patrol visit${r.visitsCreated === 1 ? "" : "s"}`);
        setFeedback(
          parts.length ? `Created ${parts.join(" + ")}.` : "Already up to date.",
        );
      } catch {
        setFeedback("Sync failed — try again.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-secondary text-sm"
        title="Materialise today + tomorrow's recurring schedules into Jobs / Visits"
      >
        {pending ? "Syncing…" : "Sync schedules"}
      </button>
      {feedback && (
        <span className="text-xs text-slate-500">{feedback}</span>
      )}
    </div>
  );
}
