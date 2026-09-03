import Link from "next/link";
import type { ComponentType } from "react";
import { STAT_TONE, type StatTone } from "@/components/StatCard";

export type HubCard = {
  href: string;
  title: string;
  blurb: string;
  stat: number;
  statLabel: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  tone: StatTone;
  /** Tool/link cards have no meaningful count — show an "Open" affordance
   *  instead of a big "0". */
  tool?: boolean;
};

/**
 * Landing-page card grid shared by the Operations and Admin hubs. Each tile
 * is a colourful link — a gradient icon chip, a tinted border, a coloured
 * stat and a soft corner wash — matching the shared StatCard so the whole
 * app reads as one system.
 */
export function HubGrid({ cards }: { cards: HubCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const t = STAT_TONE[c.tone];
        const Icon = c.icon;
        return (
          <Link
            key={c.href}
            href={c.href}
            className={
              "relative overflow-hidden rounded-2xl border p-5 shadow-md " +
              "bg-gradient-to-br from-white " +
              t.tint +
              " transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 " +
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
            <div className="relative flex items-start justify-between gap-3">
              <span
                className={
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm " +
                  t.chip
                }
              >
                <Icon size={18} />
              </span>
              <div className="text-right">
                {c.tool ? (
                  <span className={"text-sm font-semibold " + t.value}>
                    Open →
                  </span>
                ) : (
                  <>
                    <div
                      className={
                        "text-2xl font-semibold tabular-nums tracking-tight " +
                        t.value
                      }
                    >
                      {c.stat.toLocaleString("en-GB")}
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                      {c.statLabel}
                    </div>
                  </>
                )}
              </div>
            </div>
            <h2 className="relative mt-3 font-semibold text-brand-navy">
              {c.title}
            </h2>
            <p className="relative mt-1 text-sm text-slate-500">{c.blurb}</p>
          </Link>
        );
      })}
    </div>
  );
}
