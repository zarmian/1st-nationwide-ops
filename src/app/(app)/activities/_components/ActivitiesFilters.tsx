"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Opt = { v: string; label: string };

export function ActivitiesFilters({
  initial,
  regions,
  customers,
  partners,
  officers,
  jobTypes,
  visitKinds,
}: {
  initial: {
    from: string;
    to: string;
    customerId: string;
    partnerId: string;
    officerId: string;
    regionId: string;
    kind: string;
    status: string;
    groupBy: string;
  };
  regions: { id: number; name: string }[];
  customers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  officers: { id: string; name: string }[];
  jobTypes: Opt[];
  visitKinds: Opt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

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
    const next = new URLSearchParams(sp.toString());
    next.set("from", ymd(from));
    next.set("to", ymd(to));
    next.delete("page");
    router.replace(`/activities?${next.toString()}`);
  }

  return (
    <form className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={initial.from}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={initial.to}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select
            id="status"
            name="status"
            defaultValue={initial.status}
            className="input"
          >
            <option value="completed">Completed</option>
            <option value="billed">Billed in range</option>
            <option value="paid">Paid in range</option>
            <option value="all">All (scheduled in range)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="groupBy">Group by</label>
          <select
            id="groupBy"
            name="groupBy"
            defaultValue={initial.groupBy}
            className="input"
          >
            <option value="none">No grouping (list)</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="label" htmlFor="customerId">Customer</label>
          <select
            id="customerId"
            name="customerId"
            defaultValue={initial.customerId}
            className="input"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="partnerId">Partner</label>
          <select
            id="partnerId"
            name="partnerId"
            defaultValue={initial.partnerId}
            className="input"
          >
            <option value="">All partners</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="officerId">Officer</label>
          <select
            id="officerId"
            name="officerId"
            defaultValue={initial.officerId}
            className="input"
          >
            <option value="">All officers</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="regionId">Region</label>
          <select
            id="regionId"
            name="regionId"
            defaultValue={initial.regionId}
            className="input"
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label" htmlFor="kind">Service / type</label>
          <select
            id="kind"
            name="kind"
            defaultValue={initial.kind}
            className="input"
          >
            <option value="">All</option>
            <optgroup label="Jobs">
              {jobTypes.map((t) => (
                <option key={t.v} value={t.v}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Visits">
              {visitKinds.map((k) => (
                <option key={k.v} value={k.v}>{k.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="flex items-end gap-2 lg:col-span-3">
          <button type="submit" className="btn-secondary text-sm">
            Apply
          </button>
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
    </form>
  );
}
