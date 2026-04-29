"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkUpdateSites } from "../_actions";

export type SiteRow = {
  id: string;
  code: string | null;
  name: string;
  postcodeFormatted: string;
  type: string;
  services: string[];
  regionName: string | null;
  customerName: string | null;
  partnerName: string | null;
  onboardingStage: string | null;
};

const SERVICE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  KEYHOLDING: "Keyholding",
  PATROL: "Mobile patrol",
  LOCKUP: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
  ADHOC: "Ad-hoc",
};

export function SitesTable({
  rows,
  customers,
  regions,
}: {
  rows: SiteRow[];
  customers: { id: string; name: string }[];
  regions: { id: number; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      if (rows.every((r) => s.has(r.id))) {
        const next = new Set(s);
        rows.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(s);
      rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  return (
    <>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all rows on this page"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
                />
              </th>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Postcode</Th>
              <Th>Type</Th>
              <Th>Services</Th>
              <Th>Region</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isSel = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={isSel ? "bg-brand-mint-light/30" : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={isSel}
                      onChange={() => toggle(r.id)}
                      className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wider text-slate-500">
                    {r.code ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/sites/${r.id}`}
                        className="font-medium text-brand-navy hover:text-brand-mint-dark"
                      >
                        {r.name}
                      </Link>
                      {r.onboardingStage && (
                        <span className="chip-amber">
                          Onboarding · {prettyStage(r.onboardingStage)}
                        </span>
                      )}
                    </div>
                    {(r.customerName || r.partnerName) && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {r.customerName ??
                          (r.partnerName ? `${r.partnerName} (partner)` : "")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {r.postcodeFormatted}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="chip-slate">{prettyType(r.type)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.services.map((svc) => (
                        <span key={svc} className="chip-mint">
                          {SERVICE_LABEL[svc] ?? svc.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.regionName ? (
                      <span className="chip-slate">{r.regionName}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={7}>
                  No sites match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          selectedIds={Array.from(selected)}
          customers={customers}
          regions={regions}
          onDone={clearSelection}
        />
      )}
    </>
  );
}

function BulkActionBar({
  selectedIds,
  customers,
  regions,
  onDone,
}: {
  selectedIds: string[];
  customers: { id: string; name: string }[];
  regions: { id: number; name: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customerChoice, setCustomerChoice] = useState<string>(""); // "" | "__clear__" | id
  const [regionChoice, setRegionChoice] = useState<string>(""); // "" | "__clear__" | id
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCustomerChoice("");
    setRegionChoice("");
    setError(null);
  }

  function apply() {
    setError(null);
    const customerId =
      customerChoice === ""
        ? undefined
        : customerChoice === "__clear__"
          ? null
          : customerChoice;
    const regionId =
      regionChoice === ""
        ? undefined
        : regionChoice === "__clear__"
          ? null
          : Number(regionChoice);

    if (customerId === undefined && regionId === undefined) {
      setError("Pick a customer and/or region to assign.");
      return;
    }

    startTransition(async () => {
      const res = await bulkUpdateSites({
        ids: selectedIds,
        customerId,
        regionId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="sticky bottom-4 z-30 mx-auto w-full max-w-5xl">
      <div className="card border-brand-navy/20 shadow-lg p-3 flex flex-wrap items-center gap-3 bg-white">
        <div className="font-medium text-brand-navy">
          {selectedIds.length} selected
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-slate-500">
            Customer
          </label>
          <select
            value={customerChoice}
            onChange={(e) => setCustomerChoice(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-brand-mint focus:outline-none focus:ring-2 focus:ring-brand-mint/30"
            disabled={pending}
          >
            <option value="">— don't change —</option>
            <option value="__clear__">— clear —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-slate-500">
            Region
          </label>
          <select
            value={regionChoice}
            onChange={(e) => setRegionChoice(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-brand-mint focus:outline-none focus:ring-2 focus:ring-brand-mint/30"
            disabled={pending}
          >
            <option value="">— don't change —</option>
            <option value="__clear__">— clear —</option>
            {regions.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {error && (
            <span className="text-sm text-red-600 mr-2">{error}</span>
          )}
          <button
            type="button"
            onClick={onDone}
            className="btn-ghost text-sm"
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="btn-primary"
            disabled={pending}
          >
            {pending ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
      {children}
    </th>
  );
}

function prettyType(t: string) {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function prettyStage(stage: string) {
  return stage
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
