import Link from "next/link";
import { formatNumber } from "@/lib/numbers";

/**
 * Horizontal bar list — the data-dense dashboard staple for ranking a
 * handful of categories by magnitude (revenue by service, activity by
 * type, workload by region, …).
 *
 * Server-rendered, zero-dep, no client JS. Each row shows the label and
 * the exact value as text (never color/length alone — meets the
 * "values always visible" accessibility bar), with a proportional track
 * behind it. Rows can optionally link to a drill-down.
 *
 * Values are normalised against the largest row so the longest bar fills
 * the track; everything else scales relative to it.
 */
export type BarListItem = {
  label: string;
  value: number;
  /** Pre-formatted display string for the value (e.g. "£1,240"). Falls back to value. */
  display?: string;
  href?: string;
  /** Optional secondary muted text after the label (e.g. a count). */
  hint?: string;
};

export function BarList({
  items,
  tone = "blue",
  emptyLabel = "No data in range.",
  max,
}: {
  items: BarListItem[];
  tone?: "blue" | "navy" | "amber" | "slate";
  emptyLabel?: string;
  /** Override the normalisation ceiling (defaults to the largest value). */
  max?: number;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">
        {emptyLabel}
      </p>
    );
  }

  const ceiling = Math.max(max ?? 0, ...items.map((i) => i.value), 1);
  // Gradient tracks read more vibrant than a flat pale fill, while staying
  // low-contrast enough that the dark label + value on top stay legible.
  const track: Record<string, string> = {
    blue: "bg-gradient-to-r from-brand-blue-200 to-brand-blue-50",
    navy: "bg-gradient-to-r from-indigo-200 to-indigo-50",
    amber: "bg-gradient-to-r from-amber-200 to-amber-50",
    slate: "bg-gradient-to-r from-slate-200 to-slate-50",
  };

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item, i) => {
        const pct = Math.max(2, Math.round((item.value / ceiling) * 100));
        const Row = (
          <div className="relative flex items-center justify-between gap-3 px-4 py-2.5">
            {/* Proportional track sits behind the text, low-contrast so it
                doesn't compete with the labels. */}
            <div
              className={`absolute inset-y-1 left-0 rounded-r-md ${track[tone]}`}
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
            <span className="relative min-w-0 truncate text-sm font-medium text-brand-navy">
              {item.label}
              {item.hint && (
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  {item.hint}
                </span>
              )}
            </span>
            <span className="relative shrink-0 text-sm font-semibold tabular-nums text-brand-navy">
              {item.display ?? formatNumber(item.value)}
            </span>
          </div>
        );
        return (
          <li key={`${item.label}-${i}`}>
            {item.href ? (
              <Link
                href={item.href}
                className="block hover:bg-brand-blue-50/40 transition-colors"
              >
                {Row}
              </Link>
            ) : (
              Row
            )}
          </li>
        );
      })}
    </ul>
  );
}
