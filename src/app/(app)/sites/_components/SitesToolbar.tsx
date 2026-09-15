"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NONE_VALUE, SITE_SORTS } from "@/lib/siteFilters";

type Lookup<K extends string | number> = { v: K; label: string };

const SITE_TYPES: Lookup<string>[] = [
  { v: "COMMERCIAL", label: "Commercial" },
  { v: "RESIDENTIAL", label: "Residential" },
  { v: "RETAIL", label: "Retail" },
  { v: "STORAGE", label: "Storage" },
  { v: "INDUSTRIAL", label: "Industrial" },
  { v: "OTHER", label: "Other" },
];

const SERVICES: Lookup<string>[] = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "KEYHOLDING", label: "Keyholding" },
  { v: "PATROL", label: "Mobile patrol" },
  { v: "LOCKUP", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "VPI", label: "VPI" },
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
  { v: "ADHOC", label: "Ad-hoc" },
];

const STATUSES: Lookup<string>[] = [
  { v: "active", label: "Active only" },
  { v: "inactive", label: "Inactive only" },
  { v: "all", label: "Active + inactive" },
];

export type ToolbarInitial = {
  q: string;
  region: string;
  service: string;
  type: string;
  partner: string;
  customer: string;
  status: string;
  sort: string;
  dupes: string;
};

export function SitesToolbar({
  regions,
  customers,
  partners,
  dupeCount,
  initial,
}: {
  regions: { name: string }[];
  customers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  dupeCount: number;
  initial: ToolbarInitial;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRun = useRef(true);

  // Debounced URL sync for live search.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const handle = setTimeout(() => {
      pushParam("q", q);
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // ⌘K / Ctrl+K to focus search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!isModK) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.target !== inputRef.current) return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pushParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  function clearFilters() {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  const activeFilterCount =
    (initial.region ? 1 : 0) +
    (initial.customer ? 1 : 0) +
    (initial.partner ? 1 : 0) +
    (initial.service ? 1 : 0) +
    (initial.type ? 1 : 0) +
    (initial.status && initial.status !== "active" ? 1 : 0);

  const regionOptions = [
    { v: NONE_VALUE, label: "— No region —" },
    ...regions.map((r) => ({ v: r.name, label: r.name })),
  ];
  const customerOptions = [
    { v: NONE_VALUE, label: "— No customer —" },
    ...customers.map((c) => ({ v: c.id, label: c.name })),
  ];
  const partnerOptions = [
    { v: NONE_VALUE, label: "— No partner —" },
    ...partners.map((p) => ({ v: p.id, label: p.name })),
  ];

  return (
    <div className="space-y-2">
      <div className="card p-3">
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, code, postcode, customer…"
            className="input pr-16"
            aria-label="Search sites"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs uppercase tracking-wider text-slate-500 mr-1">
          Filters
        </span>
        <FilterSelect
          ariaLabel="Region"
          value={initial.region}
          options={regionOptions}
          allLabel="All regions"
          onChange={(v) => pushParam("region", v)}
        />
        <FilterSelect
          ariaLabel="Customer"
          value={initial.customer}
          options={customerOptions}
          allLabel="All customers"
          onChange={(v) => pushParam("customer", v)}
        />
        <FilterSelect
          ariaLabel="Partner"
          value={initial.partner}
          options={partnerOptions}
          allLabel="All partners"
          onChange={(v) => pushParam("partner", v)}
        />
        <FilterSelect
          ariaLabel="Type"
          value={initial.type}
          options={SITE_TYPES}
          allLabel="All types"
          onChange={(v) => pushParam("type", v)}
        />
        <FilterSelect
          ariaLabel="Service"
          value={initial.service}
          options={SERVICES}
          allLabel="All services"
          onChange={(v) => pushParam("service", v)}
        />

        {/* Show/hide inactive sites. */}
        <PlainSelect
          ariaLabel="Show"
          value={initial.status || "active"}
          options={STATUSES}
          onChange={(v) => pushParam("status", v === "active" ? "" : v)}
        />

        {dupeCount > 0 && (
          <button
            type="button"
            aria-pressed={initial.dupes === "1"}
            onClick={() =>
              pushParam("dupes", initial.dupes === "1" ? "" : "1")
            }
            className={
              "inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm transition-colors " +
              (initial.dupes === "1"
                ? "border-red-400 bg-red-50 text-red-700"
                : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100")
            }
            title="Sites sharing a name or postcode with another — a manual add plus an import, say."
          >
            ⚠ {dupeCount} possible duplicate{dupeCount === 1 ? "" : "s"}
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Sort</span>
          <PlainSelect
            ariaLabel="Sort by"
            value={initial.sort || "code"}
            options={SITE_SORTS.map((s) => ({ v: s.v, label: s.label }))}
            onChange={(v) => pushParam("sort", v === "code" ? "" : v)}
          />
        </div>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-slate-500 hover:text-brand-blue-dark underline underline-offset-2"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

const selectClass = (active: boolean) =>
  `rounded-xl border px-3 py-1.5 text-sm bg-white ${
    active
      ? "border-brand-blue text-brand-navy"
      : "border-slate-300 text-slate-600"
  } focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30`;

function FilterSelect({
  ariaLabel,
  value,
  options,
  allLabel,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: { v: string; label: string }[];
  allLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectClass(Boolean(value))}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Select with no "all" option and a real default (status, sort). */
function PlainSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const isDefault = value === options[0]?.v;
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectClass(!isDefault)}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
