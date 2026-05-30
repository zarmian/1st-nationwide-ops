"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ResetCounts,
  ResetResult,
  ResetScope,
} from "../_actions";

type ScopeKey = keyof ResetScope;

type ScopeDef = {
  key: ScopeKey;
  label: string;
  blurb: string;
  rows: Array<{ label: string; count: number; muted?: boolean }>;
  forcedBy?: (s: ResetScope) => boolean;
};

function buildScopes(counts: ResetCounts): ScopeDef[] {
  return [
    {
      key: "sites",
      label: "Site data",
      blurb:
        "Sites, jobs, alarms, visits, schedules, keys, submissions, reviews, " +
        "client reports, shifts, site rates, access instructions, and " +
        "site-scoped form templates.",
      rows: [
        { label: "Sites", count: counts.sites },
        { label: "Jobs", count: counts.jobs },
        { label: "Alarm events", count: counts.alarmEvents },
        { label: "Patrol schedules", count: counts.patrolSchedules },
        { label: "Patrol visits", count: counts.patrolVisits },
        { label: "Lock/unlock schedules", count: counts.lockUnlockSchedules },
        { label: "Shifts", count: counts.shifts },
        { label: "Form submissions", count: counts.formSubmissions },
        { label: "Report reviews", count: counts.reportReviews },
        { label: "Client reports", count: counts.clientReports },
        { label: "Key sets", count: counts.keySets },
        { label: "Keys", count: counts.keys },
        { label: "Key movements", count: counts.keyMovements },
        { label: "Access instructions", count: counts.accessInstructions },
        { label: "Onboarding pipelines", count: counts.onboardingPipelines },
        { label: "Site rates", count: counts.siteRates },
        {
          label: "Site-scoped form templates",
          count: counts.formTemplatesSiteScope,
        },
      ],
    },
    {
      key: "officers",
      label: "Officers",
      blurb:
        `Every user except admins (${counts.admins} admin${counts.admins === 1 ? "" : "s"} kept). ` +
        "Also clears officer rates and the notification queue. Requires site " +
        "data to be reset in the same run.",
      forcedBy: (s) => s.officers,
      rows: [
        { label: "Officers (non-admin users)", count: counts.officers },
        { label: "Officer rates", count: counts.officerRates },
        { label: "Notifications", count: counts.notifications },
        { label: "Admins kept", count: counts.admins, muted: true },
      ],
    },
    {
      key: "regions",
      label: "Regions",
      blurb:
        "Regional groupings (London, South, North, etc). Sites must be reset " +
        "first; if officers aren't also being reset, their regionId is nulled.",
      rows: [{ label: "Regions", count: counts.regions }],
    },
    {
      key: "partners",
      label: "Partners",
      blurb:
        "Subcontractors and partner customers (Nexus, Keyholding Co, etc.) " +
        "and their contacts. Requires site data to be reset.",
      rows: [
        { label: "Partners", count: counts.partners },
        { label: "Partner contacts", count: counts.partnerContacts },
      ],
    },
    {
      key: "customers",
      label: "Customers",
      blurb:
        "Direct customers (Shurgard, Aegis, Orbis, etc.) and their contacts. " +
        "Requires site data to be reset.",
      rows: [
        { label: "Customers", count: counts.customers },
        { label: "Customer contacts", count: counts.customerContacts },
      ],
    },
    {
      key: "activities",
      label: "Activity log",
      blurb:
        "Truncates every audit-log row. If left unchecked, only site/job/" +
        "visit/alarm logs are wiped (when site data is reset).",
      rows: [
        { label: "All activity logs", count: counts.activityLogsAll },
        {
          label: "Site-scoped only",
          count: counts.activityLogsSiteScope,
          muted: true,
        },
      ],
    },
  ];
}

export function ResetPanel({
  counts,
  reset,
}: {
  counts: ResetCounts;
  reset: (scope: ResetScope, confirmation: string) => Promise<ResetResult>;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [scope, setScope] = useState<ResetScope>({
    sites: true,
    officers: false,
    regions: false,
    partners: false,
    customers: false,
    activities: false,
  });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResetResult | null>(null);

  const scopes = buildScopes(counts);

  // Reference-data resets force a site reset in the same transaction
  // (FK constraints). Reflect that in the UI: when one is checked, the sites
  // checkbox shows as forced.
  const forcesSites =
    scope.officers || scope.regions || scope.partners || scope.customers;
  const effectiveSites = scope.sites || forcesSites;
  const anySelected =
    effectiveSites ||
    scope.officers ||
    scope.regions ||
    scope.partners ||
    scope.customers ||
    scope.activities;

  function toggle(key: ScopeKey) {
    setScope((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const armed = confirmation === "RESET" && anySelected && !pending;

  function onClick() {
    if (!armed) return;
    const labels: string[] = [];
    if (effectiveSites) labels.push("site data");
    if (scope.officers) labels.push(`${counts.officers} officers`);
    if (scope.regions) labels.push(`${counts.regions} regions`);
    if (scope.partners) labels.push(`${counts.partners} partners`);
    if (scope.customers) labels.push(`${counts.customers} customers`);
    if (scope.activities) labels.push("all activity logs");
    const proceed = window.confirm(
      `This will permanently delete: ${labels.join(", ")}. ` +
        `Admins (${counts.admins}) and form blueprints are kept. Proceed?`,
    );
    if (!proceed) return;
    startTransition(async () => {
      const r = await reset(scope, confirmation);
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
        <h2 className="font-semibold text-red-700">Reset data</h2>
        <p className="text-sm text-slate-500">
          Pick what to wipe. Reference data (officers, regions, partners,
          customers) can only be reset alongside site data — Postgres rejects
          the deletes otherwise. Admins are never deleted. Form blueprints are
          kept.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {scopes.map((s) => {
          const isForced = s.key === "sites" && forcesSites && !scope.sites;
          const checked = scope[s.key] || isForced;
          const totalInScope = s.rows
            .filter((r) => !r.muted)
            .reduce((a, b) => a + b.count, 0);
          return (
            <label
              key={s.key}
              className={
                "rounded-xl border p-3 flex gap-3 cursor-pointer transition " +
                (checked
                  ? "border-red-300 bg-red-50/40"
                  : "border-slate-200 hover:border-slate-300")
              }
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-red-600 shrink-0"
                checked={checked}
                onChange={() => toggle(s.key)}
                disabled={pending}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-brand-navy">
                    {s.label}
                    {isForced && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-red-700 font-semibold">
                        required
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {totalInScope.toLocaleString("en-GB")} row
                    {totalInScope === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-snug">{s.blurb}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1 text-xs">
                  {s.rows.map((r) => (
                    <div
                      key={r.label}
                      className={
                        "flex justify-between " +
                        (r.muted ? "text-slate-400" : "")
                      }
                    >
                      <span>{r.label}</span>
                      <span
                        className={
                          "tabular-nums " +
                          (r.count > 0 && !r.muted
                            ? "text-slate-800"
                            : "text-slate-400")
                        }
                      >
                        {r.count.toLocaleString("en-GB")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {result?.ok && (
        <div className="rounded-xl border border-brand-mint/40 bg-brand-mint-light px-3 py-2 text-sm text-brand-mint-dark">
          Reset complete — {result.totalDeleted.toLocaleString("en-GB")} rows
          deleted.
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
            disabled={pending || !anySelected}
          />
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={!armed}
          className={
            armed
              ? "btn-primary text-sm bg-red-600 hover:bg-red-700 border-red-600"
              : "btn-primary text-sm opacity-50 cursor-not-allowed"
          }
        >
          {pending
            ? "Resetting…"
            : !anySelected
              ? "Select a scope above"
              : confirmation !== "RESET"
                ? "Type RESET to enable"
                : "Permanently delete selected data"}
        </button>
      </div>
    </div>
  );
}
