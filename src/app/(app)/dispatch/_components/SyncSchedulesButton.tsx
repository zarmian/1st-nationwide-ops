"use client";

import { useState, useTransition } from "react";
import {
  syncSchedulesNow,
  type SyncDiagnosticRow,
  type SyncSchedulesResult,
} from "../_actions";

/**
 * Kicks the daily schedule materialiser by hand. Same code path as the
 * Vercel cron. After the run, surfaces a per-schedule breakdown so an
 * admin can see exactly which schedules were materialised vs skipped
 * (and why) — handy when a recurring VPI / patrol "should be due today"
 * but isn't showing up.
 */
export function SyncSchedulesButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncSchedulesResult | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await syncSchedulesNow();
        setResult(r);
        setOpen(true);
      } catch {
        setError("Sync failed — try again.");
      }
    });
  }

  return (
    <div className="relative inline-block">
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
        {result && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-slate-500 hover:text-brand-navy underline"
          >
            {summarise(result)}
          </button>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {result && open && (
        <SyncDetailsPanel result={result} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function summarise(r: SyncSchedulesResult): string {
  const parts: string[] = [];
  if (r.jobsCreated)
    parts.push(`${r.jobsCreated} lock/unlock job${r.jobsCreated === 1 ? "" : "s"}`);
  if (r.visitsCreated)
    parts.push(`${r.visitsCreated} visit${r.visitsCreated === 1 ? "" : "s"}`);
  return parts.length ? `Created ${parts.join(" + ")} · details ▾` : "Already up to date · details ▾";
}

function SyncDetailsPanel({
  result,
  onClose,
}: {
  result: SyncSchedulesResult;
  onClose: () => void;
}) {
  const byDay = new Map<string, SyncDiagnosticRow[]>();
  for (const r of result.patrolDiagnostics) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date)!.push(r);
  }

  return (
    <div className="absolute right-0 mt-2 w-[420px] z-30 card p-4 space-y-3 shadow-lg max-h-[60vh] overflow-y-auto">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-brand-navy text-sm">
            Sync details
          </h3>
          <p className="text-xs text-slate-500">
            {result.visitsCreated} visit{result.visitsCreated === 1 ? "" : "s"} +{" "}
            {result.jobsCreated} lock/unlock job{result.jobsCreated === 1 ? "" : "s"} created.
            Covers {result.daysCovered.join(" + ")}.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Close details"
        >
          ✕
        </button>
      </div>

      {result.patrolDiagnostics.length === 0 ? (
        <p className="text-xs text-slate-500">
          No active patrol / VPI schedules to check.
        </p>
      ) : (
        Array.from(byDay.entries()).map(([date, rows]) => (
          <div key={date}>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              {date}
            </div>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li
                  key={`${r.date}:${r.scheduleId}`}
                  className="text-xs flex items-baseline gap-2"
                >
                  <StatusChip status={r.status} />
                  <span className="font-medium text-brand-navy">{r.siteName}</span>
                  <span className="text-slate-500">
                    · {r.kind} · {r.dayOfWeek}
                  </span>
                  {r.reason && (
                    <span className="text-slate-500 italic ml-auto">
                      {r.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

function StatusChip({ status }: { status: SyncDiagnosticRow["status"] }) {
  const cls =
    status === "created"
      ? "chip-mint"
      : status === "exists"
        ? "chip-slate"
        : "chip-amber";
  const label =
    status === "created"
      ? "new"
      : status === "exists"
        ? "exists"
        : "skipped";
  return <span className={`${cls} text-[10px]`}>{label}</span>;
}
