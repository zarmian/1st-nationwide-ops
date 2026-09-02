import Link from "next/link";
import { RANGE_PRESETS, type RangeKey } from "../_range";

/** Window switcher (Today / Yesterday / Weeks / Months), preserving other params. */
export function RangePills({
  active,
  basePath,
  extra,
  dark = false,
}: {
  active: RangeKey;
  basePath: string;
  extra?: Record<string, string>;
  /** Styled for a dark (gradient hero) background. */
  dark?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span
        className={
          "text-xs mr-0.5 " + (dark ? "text-white/60" : "text-slate-500")
        }
      >
        Period
      </span>
      {RANGE_PRESETS.map((p) => {
        const sp = new URLSearchParams({ ...(extra ?? {}), range: p.key });
        const isActive = p.key === active;
        const cls = dark
          ? isActive
            ? "bg-white text-brand-navy shadow-sm"
            : "bg-white/10 text-white/85 ring-1 ring-inset ring-white/15 hover:bg-white/20"
          : isActive
            ? "pill pill-active"
            : "pill pill-idle";
        return (
          <Link
            key={p.key}
            href={`${basePath}?${sp.toString()}`}
            className={
              dark
                ? "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                  cls
                : cls
            }
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
