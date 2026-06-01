/**
 * Single source of truth for human-facing date / time formatting.
 *
 * Rules of thumb:
 *   - Always en-GB. The UI is UK-only and British date order is expected.
 *   - Europe/London timezone for "absolute" formats — DB stores UTC but
 *     officers / admins think in local time.
 *   - "—" for null / missing values rather than empty strings, so columns
 *     stay aligned.
 */

const LOCALE = "en-GB";
const TZ = "Europe/London";

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleTimeString(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Relative-time formatter. Granular for fresh events ("just now", "5m ago",
 * "3h ago"), drops to dates for anything older than ~6 days.
 */
export function formatTimeAgo(
  d: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  const diffMs = now.getTime() - dt.getTime();
  if (diffMs < 0) {
    // Future — flip the sign and prefix "in".
    return "in " + formatDuration(Math.abs(diffMs));
  }
  if (diffMs < 60_000) return "just now";
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 6 * 24 * 60 * 60_000) {
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  }
  return formatDate(dt);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.ceil(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.ceil(ms / 3_600_000)}h`;
  return `${Math.ceil(ms / 86_400_000)}d`;
}

/**
 * "YYYY-MM-DD" for HTML date inputs and URL params. Always local — never
 * shifts on a timezone change near midnight.
 */
export function toIsoDate(d: Date | null | undefined): string {
  if (!d) return "";
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse "YYYY-MM-DD" from form input / URL into a local-midnight Date.
 * Returns null for missing / malformed inputs so callers can fall back.
 */
export function parseIsoDate(
  s: string | null | undefined,
  endOfDay = false,
): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/**
 * The Europe/London calendar date of `d` as "YYYY-MM-DD".
 *
 * Use this when you need to know which UK day an event falls on — not the
 * server's UTC day. e.g. an event at 23:30 UK / 22:30 UTC during BST is
 * still "today" in UK terms; UTC formatting would tell you it's tomorrow.
 */
export function ukDayString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Calendar-day diff between `d` and today in UK terms.
 *   0  = same UK day, 1 = tomorrow UK, -1 = yesterday UK.
 *
 * Powers the "Today / Tomorrow / Yesterday" labels in dispatch + officer
 * views — those used to use server-local midnight (UTC on Vercel), which
 * mislabelled late-evening events under "Yesterday" all summer.
 */
export function daysFromTodayUk(d: Date, now: Date = new Date()): number {
  const [y1, m1, d1] = ukDayString(now).split("-").map(Number);
  const [y2, m2, d2] = ukDayString(d).split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

/**
 * The UTC instant for a UK wall-clock moment.
 *
 * Background: cron code that wants "today 08:00 UK time → store as UTC"
 * cannot just do `new Date(y, m, d, 8)` — that uses the JS runtime's
 * local timezone, which is UTC on Vercel, so the result is 08:00 UTC
 * (= 09:00 BST). This helper finds the correct UTC instant whose
 * Europe/London wall-clock reading is the input.
 *
 * Handles DST shifts. On the "spring forward" night (clocks jump 01:00→02:00)
 * times between 01:00 and 02:00 don't exist — we return the nearest valid
 * instant. On the "fall back" night (01:00 occurs twice) we return the
 * first occurrence (the BST→GMT one), which is the conservative pick for
 * scheduling.
 */
export function ukWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number = 0,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const seenInUk = parseUkWallClock(guess);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  const seen = Date.UTC(
    seenInUk.year,
    seenInUk.month - 1,
    seenInUk.day,
    seenInUk.hour,
    seenInUk.minute,
    second,
  );
  const diffMs = wanted - seen;
  return new Date(guess.getTime() + diffMs);
}

function parseUkWallClock(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // "24" can appear instead of "00" for midnight in some Node builds —
    // normalise.
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/**
 * Adds whole UK days to a date and returns the UK calendar Y-M-D of that
 * point. Useful for crons that want to materialise "tomorrow" without
 * worrying about DST adding/removing an hour.
 */
export function ukDayPlus(d: Date, days: number): { year: number; month: number; day: number } {
  const [y, m, dd] = ukDayString(d).split("-").map(Number);
  // Walk via UTC days — the calendar day in UK shifts in lockstep with the
  // UTC day every 24h except the 23/25-hour DST transition days. Compute
  // the wall-clock 12:00 (noon) instant, shift by N days, re-read.
  const noon = ukWallClockToUtc(y, m, dd, 12, 0);
  const shifted = new Date(noon.getTime() + days * 86_400_000);
  const [y2, m2, d2] = ukDayString(shifted).split("-").map(Number);
  return { year: y2, month: m2, day: d2 };
}

/**
 * Parse an HTML <input type="datetime-local"> value as UK wall-clock time
 * and return the UTC instant. Without this helper, `new Date(s)` on the
 * server treats the bare "YYYY-MM-DDTHH:MM" as UTC (Vercel's TZ), so the
 * user types 5:45 and the DB stores 5:45 UTC (= 6:45 BST). Use this in
 * every server action that reads a datetime-local form field.
 */
export function parseUkDateTimeLocal(
  s: string | null | undefined,
): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    // Caller passed something other than the datetime-local format —
    // fall back to native parsing (some callers pass full ISO strings).
    const native = new Date(s);
    return Number.isFinite(native.getTime()) ? native : null;
  }
  return ukWallClockToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
  );
}

/**
 * Format a UTC Date back to "YYYY-MM-DDTHH:MM" in UK wall-clock terms,
 * for pre-filling <input type="datetime-local"> values. The naïve
 * `d.getFullYear() / getMonth() / …` would use the runtime TZ — UTC on
 * the server, UK in the browser — producing a hydration mismatch AND
 * the wrong default on first render.
 */
export function formatUkDateTimeLocal(
  d: Date | string | null | undefined,
): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // Intl can emit "24" for midnight on some Node builds — normalise.
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
}
