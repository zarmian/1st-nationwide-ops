"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Opt = { v: string; label: string };

/**
 * Filter form for the per-account finance detail pages (officer /
 * partner). Slimmer than ActivitiesFilters — the account itself is
 * pre-bound by the URL so we drop the customer/partner/officer
 * pickers. Keeps from/to dates, service-or-kind, site, region.
 *
 * Lives inside a FilterPanel which renders the active-filter chips
 * with one-click clears + the "Filters" toggle / count badge.
 */
export function FinanceAccountFilters({
  initial,
  basePath,
  jobTypes,
  visitKinds,
  shiftTypes,
  sites,
  regions,
}: {
  initial: {
    from: string;
    to: string;
    kind: string;
    siteId: string;
    regionId: string;
  };
  /** "/finance/officers/<id>" or "/finance/partners/<id>". */
  basePath: string;
  jobTypes: Opt[];
  visitKinds: Opt[];
  shiftTypes?: Opt[];
  sites: { id: string; name: string; code: string | null }[];
  regions: { id: number; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function applyPreset(key: "today" | "week" | "month" | "lastMonth") {
    const now = new Date();
    let from = new Date();
    let to = new Date();
    if (key === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to = now;
    } else if (key === "week") {
      to = now;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    } else if (key === "month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = now;
    } else {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    }
    const pad = (n: number) => n.toString().padStart(2, "0");
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const next = new URLSearchParams(sp.toString());
    next.set("from", ymd(from));
    next.set("to", ymd(to));
    router.replace(`${basePath}?${next.toString()}`);
  }

  return (
    <form className="space-y-3" method="GET">
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={initial.from}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={initial.to}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="kind">
            Service / type
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={initial.kind}
            className="input"
          >
            <option value="">All</option>
            <optgroup label="Jobs">
              {jobTypes.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Visits">
              {visitKinds.map((k) => (
                <option key={k.v} value={k.v}>
                  {k.label}
                </option>
              ))}
            </optgroup>
            {shiftTypes && shiftTypes.length > 0 && (
              <optgroup label="Shifts">
                {shiftTypes.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="siteId">
            Site
          </label>
          <select
            id="siteId"
            name="siteId"
            defaultValue={initial.siteId}
            className="input"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ${s.name}` : s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="regionId">
            Region
          </label>
          <select
            id="regionId"
            name="regionId"
            defaultValue={initial.regionId}
            className="input"
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        <button
          type="button"
          onClick={() => applyPreset("today")}
          className="chip-slate hover:bg-slate-200"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => applyPreset("week")}
          className="chip-slate hover:bg-slate-200"
        >
          Last 7 days
        </button>
        <button
          type="button"
          onClick={() => applyPreset("month")}
          className="chip-slate hover:bg-slate-200"
        >
          This month
        </button>
        <button
          type="button"
          onClick={() => applyPreset("lastMonth")}
          className="chip-slate hover:bg-slate-200"
        >
          Last month
        </button>
      </div>
    </form>
  );
}
