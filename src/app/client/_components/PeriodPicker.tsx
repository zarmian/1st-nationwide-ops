"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type FormEvent } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { FLOOR_DAY, RANGE_PRESETS } from "@/lib/clientPeriod";

/** The serialisable part of a resolved Period the picker needs. */
export type PickerPeriod = {
  mode: "preset" | "month" | "custom";
  key: string | null;
  month: string | null;
  fromDay: string;
  toDay: string;
  today: string;
  label: string;
};

const PILL =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";
const IDLE = "bg-white/10 text-white/85 ring-1 ring-inset ring-white/15 hover:bg-white/20";
const ACTIVE = "bg-white text-brand-navy shadow-sm";

/**
 * The period filter for the client portal, styled for the dark page header:
 * presets (Today / Yesterday / Weeks / Months), any month since the data
 * starts, or a run of days. Every choice is a URL, so the page — cards,
 * charts and tables alike — re-renders for it, and `keep` carries the page's
 * other filters (site, type) along.
 */
export function PeriodPicker({
  basePath,
  period,
  months,
  keep = {},
}: {
  basePath: string;
  period: PickerPeriod;
  months: { key: string; label: string }[];
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [datesOpen, setDatesOpen] = useState(period.mode === "custom");
  const monthId = useId();
  const datesId = useId();

  // A new period (from any control, or the back button) resets the panel.
  useEffect(() => {
    setDatesOpen(period.mode === "custom");
  }, [period.mode, period.fromDay, period.toDay]);

  const href = (params: Record<string, string>) => {
    const sp = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    return `${basePath}?${sp.toString()}`;
  };
  const go = (params: Record<string, string>) =>
    startTransition(() => router.push(href(params)));

  function showDates(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const from = String(fd.get("from") ?? "");
    const to = String(fd.get("to") ?? "");
    if (from || to) go({ from, to });
  }

  return (
    <div
      className={
        "flex flex-col items-start gap-2 sm:items-end " +
        (pending ? "cursor-wait opacity-80" : "")
      }
      aria-busy={pending || undefined}
    >
      <div
        role="group"
        aria-labelledby={`${monthId}-presets`}
        className="flex flex-wrap items-center gap-1.5 sm:justify-end"
      >
        <span id={`${monthId}-presets`} className="mr-0.5 text-xs text-white/60">
          Period
        </span>
        {RANGE_PRESETS.map((p) => {
          const active = period.mode === "preset" && period.key === p.key;
          return (
            <Link
              key={p.key}
              href={href({ range: p.key })}
              aria-current={active ? "true" : undefined}
              className={`${PILL} ${active ? ACTIVE : IDLE}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        <div className="relative">
          <label htmlFor={monthId} className="sr-only">
            Month
          </label>
          <select
            id={monthId}
            key={period.month ?? "none"}
            defaultValue={period.month ?? ""}
            onChange={(e) => e.target.value && go({ month: e.target.value })}
            className={`${PILL} appearance-none pr-8 ${
              period.mode === "month" ? ACTIVE : IDLE
            }`}
          >
            <option value="" disabled className="bg-white text-slate-500">
              Pick a month
            </option>
            {months.map((m) => (
              <option key={m.key} value={m.key} className="bg-white text-slate-900">
                {m.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            aria-hidden
            className={
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 " +
              (period.mode === "month" ? "text-brand-navy" : "text-white/80")
            }
          />
        </div>
        <button
          type="button"
          aria-expanded={datesOpen}
          aria-controls={datesId}
          onClick={() => setDatesOpen((o) => !o)}
          className={`${PILL} ${period.mode === "custom" ? ACTIVE : IDLE}`}
        >
          <CalendarDays size={14} aria-hidden />
          {period.mode === "custom" ? period.label : "Pick dates"}
        </button>
      </div>

      {datesOpen && (
        <form
          id={datesId}
          key={`${period.fromDay}:${period.toDay}`}
          action={basePath}
          method="get"
          onSubmit={showDates}
          className="flex flex-wrap items-end gap-2 sm:justify-end"
        >
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label className="text-xs text-white/70">
            From
            <input
              type="date"
              name="from"
              autoComplete="off"
              min={FLOOR_DAY}
              max={period.today}
              defaultValue={period.fromDay}
              required
              className="mt-1 block rounded-lg border-0 bg-white px-2 py-1.5 text-base text-brand-navy shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:text-sm"
            />
          </label>
          <label className="text-xs text-white/70">
            To
            <input
              type="date"
              name="to"
              autoComplete="off"
              min={FLOOR_DAY}
              max={period.today}
              defaultValue={period.toDay}
              required
              className="mt-1 block rounded-lg border-0 bg-white px-2 py-1.5 text-base text-brand-navy shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-brand-navy shadow-sm transition-colors hover:bg-brand-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            {pending ? "Loading…" : "Show dates"}
          </button>
        </form>
      )}
    </div>
  );
}
