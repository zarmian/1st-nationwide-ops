import type { ComponentType } from "react";

export type StatTone = "blue" | "emerald" | "indigo" | "amber" | "rose";

/**
 * Accent tokens per tone — a gradient icon chip, a value text colour, a
 * tinted border and a soft corner wash. Exported so link cards that can't use
 * <StatCard> directly (clickable filter tiles, hub tiles) share one palette.
 */
export const STAT_TONE: Record<
  StatTone,
  { chip: string; value: string; border: string; wash: string; tint: string }
> = {
  blue: {
    chip: "from-blue-400 to-blue-600",
    value: "text-blue-700",
    border: "border-blue-200",
    wash: "from-blue-400 to-blue-600",
    tint: "to-blue-50",
  },
  emerald: {
    chip: "from-emerald-400 to-emerald-600",
    value: "text-emerald-700",
    border: "border-emerald-200",
    wash: "from-emerald-400 to-emerald-600",
    tint: "to-emerald-50",
  },
  indigo: {
    chip: "from-indigo-400 to-indigo-600",
    value: "text-indigo-700",
    border: "border-indigo-200",
    wash: "from-indigo-400 to-indigo-600",
    tint: "to-indigo-50",
  },
  amber: {
    chip: "from-amber-400 to-amber-500",
    value: "text-amber-700",
    border: "border-amber-200",
    wash: "from-amber-400 to-amber-500",
    tint: "to-amber-50",
  },
  rose: {
    chip: "from-rose-400 to-rose-600",
    value: "text-rose-700",
    border: "border-rose-200",
    wash: "from-rose-400 to-rose-600",
    tint: "to-rose-50",
  },
};

/**
 * Colourful KPI card — a gradient icon chip, a soft corner wash, a tinted
 * border and a hover lift. Colour is the accent; the number stays crisp and
 * readable. Shared across the client portal and the internal dashboards so
 * every headline metric reads the same.
 */
export function StatCard({
  tone,
  label,
  value,
  hint,
  icon: Icon,
}: {
  tone: StatTone;
  label: string;
  value: string;
  hint?: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
}) {
  const t = STAT_TONE[tone];
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border p-5 shadow-md " +
        "bg-gradient-to-br from-white " +
        t.tint +
        " transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg " +
        t.border
      }
    >
      <div
        aria-hidden
        className={
          "pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-[0.16] blur-2xl " +
          t.wash
        }
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <span
          className={
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm " +
            t.chip
          }
        >
          <Icon size={16} />
        </span>
      </div>
      <div
        className={
          "relative mt-2 text-3xl font-semibold tabular-nums tracking-tight " +
          t.value
        }
      >
        {value}
      </div>
      {hint && (
        <div className="relative mt-0.5 text-xs text-slate-500">{hint}</div>
      )}
    </div>
  );
}
