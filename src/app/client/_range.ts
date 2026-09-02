/** Shared date-window helper for the client portal (?days=30|90|180|365). */
export const RANGE_DAYS = [30, 90, 180, 365] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

export function resolveRange(daysParam?: string): {
  days: RangeDays;
  from: Date;
  to: Date;
} {
  const days = (RANGE_DAYS as readonly number[]).includes(Number(daysParam))
    ? (Number(daysParam) as RangeDays)
    : 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { days, from, to };
}

export function rangeLabel(days: RangeDays): string {
  return days === 365 ? "Last 12 months" : `Last ${days} days`;
}
