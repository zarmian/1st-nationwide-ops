/**
 * Helpers for figuring out whether a given PatrolSchedule should produce
 * a visit on a given date, and at what time.
 *
 * Conventions:
 * - dayOfWeek match is straightforward.
 * - WEEKLY  → every matching day-of-week.
 * - FORTNIGHTLY → every other matching day-of-week. Anchor priority:
 *     1. schedule.startsOn (explicit user choice)
 *     2. schedule.createdAt (so "every other Wed starting this week" works
 *        naturally for a schedule just created on a Wednesday)
 *     3. epoch — only when neither is set, kept for legacy/safety.
 * - MONTHLY → the first matching day-of-week within the calendar month.
 *
 * Times:
 * - schedule.timeOfDay ("HH:MM" UK wall-clock) when set.
 * - Otherwise: 09:00 UK (VPI) / 22:00 UK (patrol) — both converted to UTC
 *   via ukWallClockToUtc so summer BST visits land at the right hour.
 */

import { ukDayString, ukWallClockToUtc } from "./dates";

const DAY_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export type EvaluateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Like shouldCreateVisitOn but returns the reason for any skip — for the
 * Sync-schedules dispatcher diagnostic UI. shouldCreateVisitOn keeps the
 * boolean shape for existing callers.
 */
export function evaluateSchedule(
  schedule: {
    dayOfWeek: string;
    frequency: string;
    startsOn: Date | null;
    endsOn: Date | null;
    createdAt?: Date | null;
    intervalWeeks?: number | null;
    exceptionDates?: string[] | null;
  },
  forDate: Date,
): EvaluateResult {
  const day = forDate.getUTCDay();
  if (DAY_INDEX[schedule.dayOfWeek] !== day) {
    return {
      ok: false,
      reason: `day-of-week is ${schedule.dayOfWeek}, today is ${DAY_NAMES[day]}`,
    };
  }

  const anchor =
    schedule.startsOn ?? schedule.createdAt ?? new Date(0);
  if (schedule.startsOn && forDate < startOfDayUtc(schedule.startsOn)) {
    return { ok: false, reason: "before the schedule's starts-on date" };
  }
  if (schedule.endsOn && forDate > endOfDayUtc(schedule.endsOn)) {
    return { ok: false, reason: "after the schedule's end date" };
  }
  if (schedule.exceptionDates?.length) {
    const ukIso = ukDayString(forDate);
    if (schedule.exceptionDates.includes(ukIso)) {
      return { ok: false, reason: `today (${ukIso}) is in the skip list` };
    }
  }

  if (
    schedule.intervalWeeks != null &&
    Number.isFinite(schedule.intervalWeeks) &&
    schedule.intervalWeeks >= 1
  ) {
    const ok = matchesEveryNWeeks(
      schedule.intervalWeeks,
      anchor,
      schedule.dayOfWeek,
      forDate,
    );
    return ok
      ? { ok: true }
      : {
          ok: false,
          reason: `not due — every ${schedule.intervalWeeks} weeks from the anchor`,
        };
  }

  switch (schedule.frequency) {
    case "WEEKLY":
      return { ok: true };
    case "FORTNIGHTLY":
      return matchesEveryNWeeks(2, anchor, schedule.dayOfWeek, forDate)
        ? { ok: true }
        : { ok: false, reason: "fortnightly parity skips this week" };
    case "MONTHLY":
      return forDate.getUTCDate() <= 7
        ? { ok: true }
        : { ok: false, reason: "monthly only triggers in week 1 of the month" };
    default:
      return { ok: false, reason: `unknown frequency: ${schedule.frequency}` };
  }
}

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function shouldCreateVisitOn(
  schedule: Parameters<typeof evaluateSchedule>[0],
  forDate: Date,
): boolean {
  return evaluateSchedule(schedule, forDate).ok;
}

function matchesEveryNWeeks(
  n: number,
  anchor: Date,
  dayOfWeek: string,
  forDate: Date,
): boolean {
  // Walk the anchor forward to the first matching day-of-week so the
  // interval is measured from instances of the chosen day, not arbitrary
  // dates.
  const firstMatch = startOfDayUtc(anchor);
  const anchorDow = firstMatch.getUTCDay();
  const targetDow = DAY_INDEX[dayOfWeek];
  const daysToAdd = (targetDow - anchorDow + 7) % 7;
  firstMatch.setUTCDate(firstMatch.getUTCDate() + daysToAdd);

  const diffMs = startOfDayUtc(forDate).getTime() - firstMatch.getTime();
  if (diffMs < 0) return false;
  const weeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  return weeks % n === 0;
}

export function defaultScheduledAt(
  forDate: Date,
  kind: string,
  timeOfDay?: string | null,
): Date {
  const year = forDate.getUTCFullYear();
  const month = forDate.getUTCMonth() + 1;
  const day = forDate.getUTCDate();

  // Per-schedule override.
  if (timeOfDay) {
    const m = timeOfDay.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      return ukWallClockToUtc(year, month, day, Number(m[1]), Number(m[2]));
    }
  }
  // Kind defaults — both interpreted as UK wall-clock, not bare UTC,
  // so a "09:00 VPI" reads 09:00 BST in summer not 10:00.
  const defaultHour = kind === "VPI" ? 9 : 22;
  return ukWallClockToUtc(year, month, day, defaultHour, 0);
}

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
