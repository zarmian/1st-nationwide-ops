import { monthOptions, type Period } from "@/lib/clientPeriod";
import { PeriodPicker } from "./PeriodPicker";

/** The period picker for a page header, fed from the page's resolved period. */
export function PeriodControl({
  basePath,
  period,
  keep,
}: {
  basePath: string;
  period: Period;
  /** Other filters to carry along, e.g. { siteId, type }. */
  keep?: Record<string, string | null | undefined>;
}) {
  const { mode, key, month, fromDay, toDay, today, label } = period;
  const kept: Record<string, string> = {};
  for (const [k, v] of Object.entries(keep ?? {})) if (v) kept[k] = v;
  return (
    <PeriodPicker
      basePath={basePath}
      period={{ mode, key, month, fromDay, toDay, today, label }}
      months={monthOptions()}
      keep={kept}
    />
  );
}
