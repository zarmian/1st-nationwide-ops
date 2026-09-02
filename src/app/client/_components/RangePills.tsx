import Link from "next/link";
import { RANGE_DAYS, type RangeDays } from "../_range";

/** Window switcher (30 / 90 / 180 days / 12 months) preserving other params. */
export function RangePills({
  days,
  basePath,
  extra,
}: {
  days: RangeDays;
  basePath: string;
  extra?: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-slate-500">Period</span>
      {RANGE_DAYS.map((d) => {
        const sp = new URLSearchParams({ ...(extra ?? {}), days: String(d) });
        return (
          <Link
            key={d}
            href={`${basePath}?${sp.toString()}`}
            className={d === days ? "pill pill-active" : "pill pill-idle"}
          >
            {d === 365 ? "12 months" : `${d} days`}
          </Link>
        );
      })}
    </div>
  );
}
