"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

export function SitesToolbar({
  regions,
  initial,
}: {
  regions: { name: string }[];
  initial: { q: string; region: string; service: string; type: string };
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
    (initial.service ? 1 : 0) +
    (initial.type ? 1 : 0);

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
          name="region"
          value={initial.region}
          options={regions.map((r) => ({ v: r.name, label: r.name }))}
          allLabel="All regions"
          onChange={(v) => pushParam("region", v)}
        />
        <FilterSelect
          ariaLabel="Service"
          name="service"
          value={initial.service}
          options={SERVICES}
          allLabel="All services"
          onChange={(v) => pushParam("service", v)}
        />
        <FilterSelect
          ariaLabel="Type"
          name="type"
          value={initial.type}
          options={SITE_TYPES}
          allLabel="All types"
          onChange={(v) => pushParam("type", v)}
        />
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-slate-500 hover:text-brand-mint-dark underline underline-offset-2"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  ariaLabel,
  name,
  value,
  options,
  allLabel,
  onChange,
}: {
  ariaLabel: string;
  name: string;
  value: string;
  options: { v: string; label: string }[];
  allLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={ariaLabel}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-xl border px-3 py-1.5 text-sm bg-white ${
        value
          ? "border-brand-mint text-brand-navy"
          : "border-slate-300 text-slate-600"
      } focus:border-brand-mint focus:outline-none focus:ring-2 focus:ring-brand-mint/30`}
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
