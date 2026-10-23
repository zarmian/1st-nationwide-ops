/**
 * The client portal's period filter — one definition every /client page reads,
 * so a month picked on the overview carries to the activity log, charges,
 * sites and reports, and every card, chart and table on a page agrees.
 *
 * A period comes from the URL in one of three forms (first match wins):
 *   ?month=2026-09                       any whole month since the portal's data starts
 *   ?from=2026-09-05&to=2026-09-12       a run of days (UK calendar dates)
 *   ?range=today|yesterday|weeks|months  a preset (the default is months)
 *
 * Days are UK calendar days. A window never starts before the data floor
 * (1 September 2026, when the portal's data begins) and never runs past now.
 */
import { ukDayString, ukWallClockToUtc } from "@/lib/dates";
import type { Bucket } from "@/lib/clientPortal";

export type RangeKey = "today" | "yesterday" | "weeks" | "months";

export const RANGE_PRESETS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "weeks", label: "Weeks" },
  { key: "months", label: "Months" },
];

/** The first day (and month) with portal data. */
export const FLOOR_DAY = "2026-09-01";
export const FIRST_MONTH = FLOOR_DAY.slice(0, 7);

export type PeriodSearch = {
  range?: string | null;
  month?: string | null;
  from?: string | null;
  to?: string | null;
};

export type Period = {
  mode: "preset" | "month" | "custom";
  /** The preset, when mode is "preset". */
  key: RangeKey | null;
  /** "YYYY-MM", when mode is "month". */
  month: string | null;
  /** First and last UK day covered, "YYYY-MM-DD". */
  fromDay: string;
  toDay: string;
  /** Today in the UK, "YYYY-MM-DD". */
  today: string;
  from: Date;
  to: Date;
  /** How the chart groups this period: by day, week or month. */
  bucket: Bucket;
  /** "Last 12 months", "September 2026", "5 – 12 Sept 2026"… */
  label: string;
  /** The search params that give this period again, for links. */
  params: Record<string, string>;
};

// ── Calendar-day arithmetic on "YYYY-MM-DD" strings (no time zones) ───────

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const [y, m, d] = parts(day);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Inclusive number of days from a to b. */
function daySpan(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

/** A real calendar date as "YYYY-MM-DD", else null. */
function isoDay(s: string | null | undefined): string | null {
  const v = s?.trim();
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = parts(v);
  const back = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  return back === v ? v : null;
}

function startOfDay(day: string): Date {
  const [y, m, d] = parts(day);
  return ukWallClockToUtc(y, m, d, 0, 0);
}

/** The last instant of a UK day (the next day's midnight, less 1 ms — right
 *  on the 23- and 25-hour clock-change days too). */
function endOfDay(day: string): Date {
  return new Date(startOfDay(addDays(day, 1)).getTime() - 1);
}

// ── Labels ────────────────────────────────────────────────────────────────

const noon = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const DAY_FULL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "September 2026". */
export function monthLabel(month: string): string {
  return MONTH_LONG.format(noon(`${month}-01`));
}

/** "Thu, 10 Sept 2026", "5 – 12 Sept 2026", "10 Sept – 20 Oct 2026" or
 *  "20 Dec 2026 – 5 Jan 2027". */
export function daysLabel(fromDay: string, toDay: string): string {
  if (fromDay === toDay) return DAY_FULL.format(noon(fromDay));
  if (fromDay.slice(0, 7) === toDay.slice(0, 7)) {
    return `${Number(fromDay.slice(8, 10))} – ${DAY_MONTH_YEAR.format(noon(toDay))}`;
  }
  if (fromDay.slice(0, 4) === toDay.slice(0, 4)) {
    return `${DAY_MONTH.format(noon(fromDay))} – ${DAY_MONTH_YEAR.format(noon(toDay))}`;
  }
  return `${DAY_MONTH_YEAR.format(noon(fromDay))} – ${DAY_MONTH_YEAR.format(noon(toDay))}`;
}

const PRESET_LABEL: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  weeks: "Last 12 weeks",
  months: "Last 12 months",
};

// ── Resolving a period from the URL ───────────────────────────────────────

export function resolvePeriod(sp: PeriodSearch, now: Date = new Date()): Period {
  const today = ukDayString(now);
  const thisMonth = today.slice(0, 7);
  const clamp = (day: string) => (day < FLOOR_DAY ? FLOOR_DAY : day > today ? today : day);

  const build = (
    p: Pick<Period, "mode" | "key" | "month" | "bucket" | "label" | "params"> & {
      fromDay: string;
      toDay: string;
    },
  ): Period => {
    const end = endOfDay(p.toDay);
    return {
      ...p,
      today,
      from: startOfDay(p.fromDay),
      to: end.getTime() > now.getTime() ? now : end,
    };
  };

  // 1. A whole month — any month from the first with data to this one.
  const month = sp.month?.trim();
  if (
    month &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
    month >= FIRST_MONTH &&
    month <= thisMonth
  ) {
    const last = lastDayOfMonth(month);
    return build({
      mode: "month",
      key: null,
      month,
      fromDay: `${month}-01`,
      toDay: last < today ? last : today,
      bucket: "day",
      label: monthLabel(month),
      params: { month },
    });
  }

  // 2. A run of days. Either end alone is fine: the other defaults to the
  //    data floor / today. Both ends are kept inside [floor, today].
  const f = isoDay(sp.from);
  const t = isoDay(sp.to);
  if (f || t) {
    let fromDay = clamp(f ?? FLOOR_DAY);
    let toDay = clamp(t ?? today);
    if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
    const span = daySpan(fromDay, toDay);
    return build({
      mode: "custom",
      key: null,
      month: null,
      fromDay,
      toDay,
      bucket: span <= 31 ? "day" : span <= 26 * 7 ? "week" : "month",
      label: daysLabel(fromDay, toDay),
      params: { from: fromDay, to: toDay },
    });
  }

  // 3. A preset. Weeks and months start on a whole week / month, so every
  //    bar in the chart covers its whole period.
  const key: RangeKey = RANGE_PRESETS.some((p) => p.key === sp.range)
    ? (sp.range as RangeKey)
    : "months";
  let fromDay: string;
  let toDay = today;
  let bucket: Bucket;
  if (key === "today") {
    fromDay = today;
    bucket = "day";
  } else if (key === "yesterday") {
    fromDay = toDay = addDays(today, -1);
    bucket = "day";
  } else if (key === "weeks") {
    fromDay = addDays(mondayOf(today), -11 * 7);
    bucket = "week";
  } else {
    fromDay = `${addMonths(thisMonth, -11)}-01`;
    bucket = "month";
  }
  if (fromDay < FLOOR_DAY) fromDay = FLOOR_DAY;
  if (toDay < fromDay) toDay = fromDay;
  return build({
    mode: "preset",
    key,
    month: null,
    fromDay,
    toDay,
    bucket,
    label: PRESET_LABEL[key],
    params: { range: key },
  });
}

/** Every month a client can pick, newest first. */
export function monthOptions(now: Date = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let m = ukDayString(now).slice(0, 7); m >= FIRST_MONTH; m = addMonths(m, -1)) {
    out.push({ key: m, label: monthLabel(m) });
  }
  return out;
}

/** A link to `path` for a period, plus any extra filters that are set. */
export function periodHref(
  path: string,
  params: Record<string, string>,
  extra: Record<string, string | null | undefined> = {},
): string {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * The period one bar of the chart stands for — a day, a week or a month —
 * trimmed to the period on screen, as search params. A whole month reads as
 * `month=…`; anything else as `from=…&to=…`.
 */
export function bucketParams(
  p: Pick<Period, "fromDay" | "toDay" | "today" | "bucket">,
  key: string,
): Record<string, string> {
  let first: string;
  let last: string;
  if (p.bucket === "month") {
    first = `${key}-01`;
    last = lastDayOfMonth(key);
  } else if (p.bucket === "week") {
    first = key;
    last = addDays(key, 6);
  } else {
    first = last = key;
  }
  const from = first < p.fromDay ? p.fromDay : first;
  const to = last > p.toDay ? p.toDay : last;
  // A month that's all in view — or this month, so far — is just that month.
  if (p.bucket === "month" && from === first && (to === last || to === p.today)) {
    return { month: key };
  }
  return { from, to };
}
