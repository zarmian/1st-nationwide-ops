import { ukWallClockToUtc, ukDayPlus, ukDayString } from "@/lib/dates";

/**
 * Client-portal time window. Named presets (Today / Yesterday / Weeks /
 * Months) rather than raw day counts, each with the chart bucket to use.
 */
export type RangeKey = "today" | "yesterday" | "weeks" | "months";
export type Bucket = "day" | "week" | "month";

export const RANGE_PRESETS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "weeks", label: "Weeks" },
  { key: "months", label: "Months" },
];

const KEYS = RANGE_PRESETS.map((p) => p.key);

function startOfUkDay(d: Date): Date {
  const [y, m, day] = ukDayString(d).split("-").map(Number);
  return ukWallClockToUtc(y, m, day, 0, 0);
}

export function resolveRange(param?: string): {
  key: RangeKey;
  from: Date;
  to: Date;
  bucket: Bucket;
} {
  const key = (KEYS.includes(param as RangeKey) ? param : "months") as RangeKey;
  const now = new Date();

  if (key === "today") {
    return { key, from: startOfUkDay(now), to: now, bucket: "day" };
  }
  if (key === "yesterday") {
    const todayStart = startOfUkDay(now);
    const y = ukDayPlus(now, -1);
    return {
      key,
      from: ukWallClockToUtc(y.year, y.month, y.day, 0, 0),
      to: new Date(todayStart.getTime() - 1),
      bucket: "day",
    };
  }
  if (key === "weeks") {
    // ~12 weeks back, bucketed by week.
    return {
      key,
      from: new Date(now.getTime() - 12 * 7 * 86_400_000),
      to: now,
      bucket: "week",
    };
  }
  // months — ~12 months back, bucketed by month.
  return {
    key,
    from: new Date(now.getTime() - 365 * 86_400_000),
    to: now,
    bucket: "month",
  };
}

export function rangeLabel(key: RangeKey): string {
  switch (key) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "weeks":
      return "Last 12 weeks";
    case "months":
      return "Last 12 months";
  }
}
