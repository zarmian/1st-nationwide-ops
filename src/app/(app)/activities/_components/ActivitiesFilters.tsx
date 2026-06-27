"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FilterPills } from "@/components/FilterPills";
import { MultiSelect } from "@/components/MultiSelect";

type Opt = { v: string; label: string };

/**
 * /activities filter row. All facet pickers are multi-select (the user
 * can scope to several customers, officers, services, etc. at once)
 * with a free-text search inside each popover so the site picker
 * stays usable with hundreds of options. Each toggle navigates via
 * router.replace; there's no Apply button — changes commit instantly.
 *
 * The date inputs still need a commit step (typing a partial date
 * shouldn't fire a navigation) so they go through onBlur / Enter.
 */
export function ActivitiesFilters({
  initial,
  regions,
  customers,
  partners,
  officers,
  sites,
  jobTypes,
  visitKinds,
  shiftKinds = [],
}: {
  initial: { from: string; to: string };
  regions: { id: number; name: string }[];
  customers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  officers: { id: string; name: string }[];
  sites: { id: string; name: string; code: string | null }[];
  jobTypes: Opt[];
  visitKinds: Opt[];
  shiftKinds?: Opt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function commitDate(key: "from" | "to", value: string) {
    const next = new URLSearchParams(sp?.toString() ?? "");
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`/activities?${next.toString()}`);
  }

  function preset(key: "today" | "week" | "month" | "lastMonth") {
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
    const next = new URLSearchParams(sp?.toString() ?? "");
    next.set("from", ymd(from));
    next.set("to", ymd(to));
    next.delete("page");
    router.replace(`/activities?${next.toString()}`);
  }

  const allKindOptions: Opt[] = [
    ...jobTypes.map((t) => ({ v: t.v, label: `Job — ${t.label}` })),
    ...visitKinds.map((k) => ({ v: k.v, label: `Visit — ${k.label}` })),
    ...shiftKinds.map((k) => ({ v: k.v, label: `Shift — ${k.label}` })),
  ];

  const statusOptions: Opt[] = [
    { v: "scheduled", label: "Scheduled" },
    { v: "in_progress", label: "In progress" },
    { v: "completed", label: "Completed" },
    { v: "missed", label: "Missed" },
    { v: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input
            id="from"
            type="date"
            defaultValue={initial.from}
            onChange={(e) => commitDate("from", e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input
            id="to"
            type="date"
            defaultValue={initial.to}
            onChange={(e) => commitDate("to", e.target.value)}
            className="input"
          />
        </div>
        <div className="lg:col-span-2 flex items-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => preset("today")}
            className="chip-slate hover:bg-slate-200"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => preset("week")}
            className="chip-slate hover:bg-slate-200"
          >
            Last 7 days
          </button>
          <button
            type="button"
            onClick={() => preset("month")}
            className="chip-slate hover:bg-slate-200"
          >
            This month
          </button>
          <button
            type="button"
            onClick={() => preset("lastMonth")}
            className="chip-slate hover:bg-slate-200"
          >
            Last month
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MultiSelect
          paramKey="customerId"
          label="Customer"
          defaultLabel="All customers"
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
        />
        <MultiSelect
          paramKey="partnerId"
          label="Partner"
          defaultLabel="All partners"
          options={partners.map((p) => ({ value: p.id, label: p.name }))}
        />
        <MultiSelect
          paramKey="officerId"
          label="Officer"
          defaultLabel="All officers"
          options={officers.map((o) => ({ value: o.id, label: o.name }))}
        />
        <MultiSelect
          paramKey="regionId"
          label="Region"
          defaultLabel="All regions"
          options={regions.map((r) => ({
            value: String(r.id),
            label: r.name,
          }))}
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <MultiSelect
          paramKey="siteId"
          label="Site"
          defaultLabel="All sites"
          options={sites.map((s) => ({
            value: s.id,
            label: s.code ? `${s.code} · ${s.name}` : s.name,
          }))}
        />
        <MultiSelect
          paramKey="kind"
          label="Service / type"
          defaultLabel="All services"
          options={allKindOptions.map((o) => ({ value: o.v, label: o.label }))}
        />
        <MultiSelect
          paramKey="status"
          label="Status"
          defaultLabel="All statuses"
          options={statusOptions.map((s) => ({ value: s.v, label: s.label }))}
        />
        <div>
          <label className="label">Group by</label>
          <FilterPills
            paramKey="groupBy"
            defaultValue="none"
            options={[
              { value: "none", label: "List" },
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
