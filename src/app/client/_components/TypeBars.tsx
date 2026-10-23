"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { formatHours, formatNumber } from "@/lib/numbers";
import type { ActivityGroup } from "@/lib/clientPortal";
import { GROUP_COLOR } from "./groupColors";

export type TypeBarSegment = {
  group: ActivityGroup;
  count: number;
  hours: number;
  /** The activity log for this period and type. */
  href: string;
};

export type TypeBarColumn = {
  key: string;
  /** Full name for the tooltip and table: "Sept 2026", "Thu 10 Sept". */
  label: string;
  /** Axis label: "Sept", "10". */
  short: string;
  /** The activity log for this period. */
  href: string;
  count: number;
  /** Non-empty types only, in the fixed type order (bottom of the bar first). */
  segments: TypeBarSegment[];
};

export type TypeBarSeries = { group: ActivityGroup; label: string };

/** A segment's value as people read it: hours for guarding, a count otherwise. */
function valueText(s: Pick<TypeBarSegment, "group" | "count" | "hours">): string {
  return s.group === "guarding" ? formatHours(s.hours) : formatNumber(s.count);
}

function activities(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? "activity" : "activities"}`;
}

/**
 * Stacked column chart of activity per period, one colour per type of work.
 * A bar's height is the number of activities (a guarding shift counts as one);
 * guarding hours show in the tooltip and the table. Each coloured segment
 * opens the activity log for that period and type; anywhere else in the
 * column opens the period. The axis labels are the keyboard path (focus
 * shows the same tooltip), and "Show as a table" has every value.
 */
export function TypeBars({
  columns,
  series,
  periodHeading,
  label,
  height = 200,
}: {
  columns: TypeBarColumn[];
  series: TypeBarSeries[];
  /** Table heading for the period column: "Month", "Week", "Day". */
  periodHeading: string;
  label: string;
  height?: number;
}) {
  const [active, setActive] = useState<{ i: number; g: ActivityGroup | null } | null>(null);
  const n = columns.length;
  const max = Math.max(1, ...columns.map((c) => c.count));
  const showCaps = n <= 14; // a total on every cap only while they fit
  const plot = height - (showCaps ? 18 : 0);
  const labelEvery = Math.max(1, Math.ceil(n / 10));
  const seriesLabel = (g: ActivityGroup) => series.find((s) => s.group === g)?.label ?? g;

  return (
    <div role="group" aria-label={label}>
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600">
        {series.map((s) => (
          <li key={s.group} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: GROUP_COLOR[s.group] }}
            />
            {s.label}
          </li>
        ))}
      </ul>

      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="flex items-end gap-1 sm:gap-2" style={{ height }}>
          {columns.map((c, i) => {
            const barPx = Math.max(4, Math.round((c.count / max) * plot));
            const dim = active !== null && active.i !== i;
            return (
              <div
                key={c.key}
                className={
                  "relative flex h-full min-w-0 flex-1 flex-col items-center justify-end transition-opacity duration-150 motion-reduce:transition-none " +
                  (dim ? "opacity-50" : "")
                }
                onMouseEnter={() => setActive({ i, g: null })}
              >
                {/* The whole column opens the period — a bigger target than
                    the bar. Keyboard users have the axis label instead. */}
                <Link
                  href={c.href}
                  tabIndex={-1}
                  aria-hidden
                  className="absolute inset-0"
                />
                {showCaps && c.count > 0 && (
                  <span className="pointer-events-none relative mb-1 text-[10px] font-medium leading-none tabular-nums text-slate-500">
                    {formatNumber(c.count)}
                  </span>
                )}
                {c.count > 0 ? (
                  <div
                    className="relative flex w-full max-w-[40px] flex-col-reverse gap-[2px]"
                    style={{ height: barPx }}
                  >
                    {c.segments.map((s, k) => (
                      <Link
                        key={s.group}
                        href={s.href}
                        tabIndex={-1}
                        aria-label={`${seriesLabel(s.group)}, ${c.label}: ${valueText(s)}`}
                        onMouseEnter={() => setActive({ i, g: s.group })}
                        className={
                          "block min-h-[2px] transition-opacity duration-150 hover:opacity-80 motion-reduce:transition-none " +
                          (k === c.segments.length - 1 ? "rounded-t" : "")
                        }
                        style={{ flex: `${s.count} 1 0px`, backgroundColor: GROUP_COLOR[s.group] }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="pointer-events-none relative h-[2px] w-full max-w-[40px] rounded-full bg-slate-200" />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex gap-1 sm:gap-2">
          {columns.map((c, i) => (
            <Link
              key={c.key}
              href={c.href}
              onFocus={() => setActive({ i, g: null })}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive({ i, g: null })}
              aria-label={`${c.label}: ${activities(c.count)}. Open the activity log.`}
              className="min-w-0 flex-1 truncate rounded text-center text-[10px] leading-5 text-slate-500 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue-500"
            >
              {i % labelEvery === 0 ? c.short : ""}
            </Link>
          ))}
        </div>

        {active && (
          <Tooltip
            column={columns[active.i]}
            index={active.i}
            count={n}
            group={active.g}
            seriesLabel={seriesLabel}
          />
        )}
      </div>

      <details className="mt-4">
        <summary className="w-fit cursor-pointer rounded text-xs font-medium text-brand-blue-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue-500">
          Show as a table
        </summary>
        <div className="table-scroll mt-2">
          <table className="table-default">
            <thead>
              <tr>
                <th>{periodHeading}</th>
                {series.map((s) => (
                  <th key={s.group} className="col-num">
                    {s.label}
                  </th>
                ))}
                <th className="col-num">All activities</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.key}>
                  <td className="whitespace-nowrap">
                    <Link href={c.href} className="font-medium text-brand-navy hover:text-brand-blue-dark">
                      {c.label}
                    </Link>
                  </td>
                  {series.map((s) => {
                    const seg = c.segments.find((x) => x.group === s.group);
                    return (
                      <td key={s.group} className="col-num tabular-nums text-slate-700">
                        {seg ? valueText(seg) : "—"}
                      </td>
                    );
                  })}
                  <td className="col-num tabular-nums text-slate-700">{formatNumber(c.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {series.some((s) => s.group === "guarding") && (
          <p className="mt-2 text-xs text-slate-500">
            Static guarding is shown in hours; each shift counts as one activity in the total.
          </p>
        )}
      </details>
    </div>
  );
}

function Tooltip({
  column: c,
  index: i,
  count: n,
  group,
  seriesLabel,
}: {
  column: TypeBarColumn;
  index: number;
  count: number;
  group: ActivityGroup | null;
  seriesLabel: (g: ActivityGroup) => string;
}) {
  // Beside the bar, never over it: to its right in the left half of the
  // chart, to its left in the right half — and kept inside the chart. Bars
  // are at most 40px wide, centred in their column.
  const pos: CSSProperties =
    i < n / 2
      ? { left: `min(calc(${((i + 0.5) / n) * 100}% + 28px), calc(100% - 15rem))` }
      : { right: `min(calc(${((n - i - 0.5) / n) * 100}% + 28px), calc(100% - 15rem))` };
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute top-0 z-10 w-60 rounded-lg bg-brand-navy px-3 py-2.5 text-xs text-white shadow-lg"
      style={pos}
    >
      <div className="font-semibold">{c.label}</div>
      <div className="text-white/70">{activities(c.count)}</div>
      {c.segments.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {c.segments.map((s) => (
            <li
              key={s.group}
              className={
                "-mx-1 flex items-center gap-2 rounded px-1 py-0.5 " +
                (group === s.group ? "bg-white/15" : "")
              }
            >
              <span
                aria-hidden
                className="h-[3px] w-3 shrink-0 rounded-full"
                style={{ backgroundColor: GROUP_COLOR[s.group] }}
              />
              <span className="whitespace-nowrap font-semibold tabular-nums">{valueText(s)}</span>
              <span className="min-w-0 text-white/70">
                {seriesLabel(s.group)}
                {s.group === "guarding" &&
                  ` · ${formatNumber(s.count)} ${s.count === 1 ? "shift" : "shifts"}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-[10px] text-white/60">
        {group ? "Click to see these" : "Click a colour to see that type"}
      </div>
    </div>
  );
}
