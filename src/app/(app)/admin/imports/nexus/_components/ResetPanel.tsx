"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ResetCounts, ResetResult } from "../_actions";

const ROW_LABELS: Array<{ key: keyof ResetCounts; label: string }> = [
  { key: "sites", label: "Sites" },
  { key: "siteRates", label: "Site rates" },
  { key: "keySets", label: "Key sets" },
  { key: "keys", label: "Keys" },
  { key: "keyMovements", label: "Key movements" },
  { key: "patrolSchedules", label: "Patrol schedules" },
  { key: "patrolVisits", label: "Patrol visits" },
  { key: "lockUnlockSchedules", label: "Lock/unlock schedules" },
  { key: "alarmEvents", label: "Alarm events" },
  { key: "jobs", label: "Jobs" },
  { key: "formSubmissions", label: "Form submissions" },
  { key: "reportReviews", label: "Report reviews" },
  { key: "clientReports", label: "Client reports" },
  { key: "formTemplatesSiteScope", label: "Site-scoped form templates" },
  { key: "accessInstructions", label: "Access instructions" },
  { key: "onboardingPipelines", label: "Onboarding pipelines" },
  { key: "activityLogs", label: "Site/job activity logs" },
];

export function ResetPanel({
  counts,
  reset,
}: {
  counts: ResetCounts;
  reset: (confirmation: string) => Promise<ResetResult>;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResetResult | null>(null);

  const total = Object.values(counts).reduce((acc, n) => acc + n, 0);
  const isEmpty = total === 0;
  const armed = confirmation === "RESET" && !isEmpty;

  function onClick() {
    if (!armed) return;
    const proceed = window.confirm(
      `This will permanently delete ${total.toLocaleString("en-GB")} rows ` +
        `across ${ROW_LABELS.filter((r) => counts[r.key] > 0).length} tables. ` +
        `Customers, partners, regions, officers, blueprints, and non-site ` +
        `templates are kept. Proceed?`,
    );
    if (!proceed) return;
    startTransition(async () => {
      const r = await reset(confirmation);
      setResult(r);
      if (r.ok) {
        setConfirmation("");
        router.refresh();
      }
    });
  }

  return (
    <div className="card p-5 space-y-4 border border-red-200">
      <div>
        <h2 className="font-semibold text-red-700">Reset site data</h2>
        <p className="text-sm text-slate-500">
          Wipes everything tied to sites — including jobs, visits, alarms,
          submissions, keys, and rates — so you can re-import from a clean
          slate. Keeps users, customers, partners, regions, blueprints, and
          form templates that aren't site-scoped.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm">
        {ROW_LABELS.map((r) => (
          <div key={r.key} className="flex justify-between">
            <span className="text-slate-500">{r.label}</span>
            <span
              className={
                counts[r.key] > 0
                  ? "text-slate-800 tabular-nums"
                  : "text-slate-400 tabular-nums"
              }
            >
              {counts[r.key].toLocaleString("en-GB")}
            </span>
          </div>
        ))}
      </div>

      {result?.ok && (
        <div className="rounded-xl border border-brand-mint/40 bg-brand-mint-light px-3 py-2 text-sm text-brand-mint-dark">
          Reset complete — {Object.values(result.deleted).reduce((a, b) => a + b, 0).toLocaleString("en-GB")} rows deleted.
        </div>
      )}
      {result && !result.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {result.error}
        </div>
      )}

      <div className="border-t border-slate-100 pt-4 space-y-3">
        <div>
          <label className="label" htmlFor="resetConfirmation">
            Type <span className="font-mono font-bold">RESET</span> to enable
          </label>
          <input
            id="resetConfirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="input font-mono"
            placeholder="RESET"
            autoComplete="off"
            disabled={pending || isEmpty}
          />
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={!armed || pending}
          className={
            armed
              ? "btn-primary text-sm bg-red-600 hover:bg-red-700 border-red-600"
              : "btn-primary text-sm opacity-50 cursor-not-allowed"
          }
        >
          {pending
            ? "Resetting…"
            : isEmpty
              ? "Nothing to reset"
              : `Permanently delete ${total.toLocaleString("en-GB")} rows`}
        </button>
      </div>
    </div>
  );
}
