import { ACTIVITY_GROUPS, type PeriodStack } from "@/lib/clientPortal";
import { bucketParams, periodHref, type Period } from "@/lib/clientPeriod";
import type { TypeBarColumn, TypeBarSeries } from "./TypeBars";

/**
 * The stacked activity chart's props for a period: one column per day, week
 * or month, each segment linking to the activity log for that period and
 * type (plus any `extra` filter, e.g. the site).
 */
export function typeChart(
  byPeriod: PeriodStack[],
  period: Period,
  extra: Record<string, string | null | undefined> = {},
): { columns: TypeBarColumn[]; series: TypeBarSeries[]; periodHeading: string } {
  const columns = byPeriod.map((p) => {
    const params = bucketParams(period, p.key);
    return {
      key: p.key,
      label: p.label,
      short: p.short,
      count: p.count,
      href: periodHref("/client/activities", params, extra),
      segments: p.groups
        .filter((g) => g.count > 0)
        .map((g) => ({
          group: g.group,
          count: g.count,
          hours: g.hours,
          href: periodHref("/client/activities", params, { ...extra, type: g.group }),
        })),
    };
  });
  const present = new Set(columns.flatMap((c) => c.segments.map((s) => s.group)));
  return {
    columns,
    series: ACTIVITY_GROUPS.filter((g) => present.has(g.key)).map((g) => ({
      group: g.key,
      label: g.label,
    })),
    periodHeading:
      period.bucket === "month" ? "Month" : period.bucket === "week" ? "Week" : "Day",
  };
}
