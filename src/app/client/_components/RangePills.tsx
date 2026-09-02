import Link from "next/link";
import { RANGE_PRESETS, type RangeKey } from "../_range";

/** Window switcher (Today / Yesterday / Weeks / Months), preserving other params. */
export function RangePills({
  active,
  basePath,
  extra,
}: {
  active: RangeKey;
  basePath: string;
  extra?: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-slate-500">Period</span>
      {RANGE_PRESETS.map((p) => {
        const sp = new URLSearchParams({ ...(extra ?? {}), range: p.key });
        return (
          <Link
            key={p.key}
            href={`${basePath}?${sp.toString()}`}
            className={p.key === active ? "pill pill-active" : "pill pill-idle"}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
