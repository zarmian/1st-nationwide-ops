import Link from "next/link";

type Datum = {
  /** Full name, for the tooltip: "Sept 2026". */
  label: string;
  /** Axis label, when shorter than `label`: "Sept". */
  short?: string;
  value: number;
  display: string;
  /** Makes the bar a link (e.g. to the activity behind it). */
  href?: string;
};

/**
 * Compact column chart for a time series (activity or spend per period).
 * Server-rendered, no client JS. Columns fill the width evenly but cap their
 * bar width, so a handful of periods reads as neat gradient columns rather
 * than a stretched line. Values sit above each bar while they fit; period
 * labels below (thinned out when there are many).
 */
export function PeriodBars({
  data,
  height = 168,
  tone = "blue",
  ariaLabel,
}: {
  data: Datum[];
  height?: number;
  tone?: "blue" | "emerald" | "indigo";
  ariaLabel?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const showValues = data.length <= 14;
  const reserve = showValues ? 20 : 0; // room for the value label above the tallest bar
  const maxBar = Math.max(8, height - reserve);
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));

  const grad =
    tone === "emerald"
      ? "from-emerald-500 to-emerald-300"
      : tone === "indigo"
        ? "from-indigo-500 to-indigo-300"
        : "from-brand-blue-600 to-brand-blue-300";

  const linked = data.some((d) => d.href);

  return (
    <div role={linked ? "group" : "img"} aria-label={ariaLabel ?? "Chart"}>
      <div className="flex items-end gap-1 sm:gap-2" style={{ height }}>
        {data.map((d, i) => {
          const barPx =
            d.value > 0 ? Math.max(4, Math.round((d.value / max) * maxBar)) : 2;
          const inner = (
            <>
              {showValues && d.value > 0 && (
                <span className="text-[10px] font-medium tabular-nums text-slate-500 leading-none">
                  {d.display}
                </span>
              )}
              <div
                className={
                  "w-full max-w-[38px] rounded-t-md transition-opacity " +
                  (d.value > 0
                    ? "bg-gradient-to-t shadow-sm group-hover:opacity-90 " + grad
                    : "bg-slate-200")
                }
                style={{ height: barPx }}
              />
            </>
          );
          const cls =
            "group flex h-full flex-1 min-w-0 flex-col items-center justify-end gap-1.5";
          return d.href ? (
            <Link
              key={i}
              href={d.href}
              title={`${d.label}: ${d.display}`}
              aria-label={`${d.label}: ${d.display}`}
              className={
                cls +
                " rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue-500"
              }
            >
              {inner}
            </Link>
          ) : (
            <div key={i} className={cls} title={`${d.label}: ${d.display}`}>
              {inner}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 sm:gap-2 mt-2" aria-hidden={linked || undefined}>
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 min-w-0 text-center text-[10px] text-slate-400 truncate"
          >
            {i % labelEvery === 0 ? (d.short ?? d.label) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
