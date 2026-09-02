/**
 * Compact column chart for a time series (activity or spend per period).
 * Server-rendered, no client JS. Columns fill the width evenly but cap their
 * bar width, so a handful of periods reads as neat columns rather than a
 * stretched line. Values sit above each bar; period labels below.
 */
export function PeriodBars({
  data,
  height = 150,
  tone = "blue",
  ariaLabel,
}: {
  data: { label: string; value: number; display: string }[];
  height?: number;
  tone?: "blue" | "navy";
  ariaLabel?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const reserve = 18; // room for the value label above the tallest bar
  const maxBar = Math.max(8, height - reserve);
  const barColor = tone === "navy" ? "bg-brand-navy" : "bg-brand-blue";

  return (
    <div role="img" aria-label={ariaLabel ?? "Chart"}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => {
          const barPx =
            d.value > 0 ? Math.max(4, Math.round((d.value / max) * maxBar)) : 1;
          return (
            <div
              key={i}
              className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1"
              title={`${d.label}: ${d.display}`}
            >
              {d.value > 0 && (
                <span className="text-[10px] tabular-nums text-slate-500 leading-none">
                  {d.display}
                </span>
              )}
              <div
                className={
                  "w-full max-w-[40px] rounded-t " +
                  (d.value > 0 ? barColor : "bg-slate-200")
                }
                style={{ height: barPx }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 min-w-0 text-center text-[10px] text-slate-400 truncate"
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
