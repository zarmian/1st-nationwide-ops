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

import { ukWallClockToUtc } from "./dates";

const DAY_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export function shouldCreateVisitOn(
  schedule: {
    dayOfWeek: string;
    frequency: string;
    startsOn: Date | null;
    endsOn: Date | null;
    createdAt?: Date | null;
  },
  forDate: Date,
): boolean {
  const day = forDate.getUTCDay();
  if (DAY_INDEX[schedule.dayOfWeek] !== day) return false;

  // Fortnightly anchor: startsOn > createdAt > epoch. createdAt makes the
  // first matching day after schedule creation count as "week 0," which
  // matches what users mean when they pick fortnightly without a date.
  const anchor =
    schedule.startsOn ?? schedule.createdAt ?? new Date(0);
  if (schedule.startsOn && forDate < startOfDayUtc(schedule.startsOn))
    return false;
  if (schedule.endsOn && forDate > endOfDayUtc(schedule.endsOn)) return false;

  switch (schedule.frequency) {
    case "WEEKLY":
      return true;
    case "FORTNIGHTLY": {
      // Whole weeks since the anchor's matching-day-of-week. Walk the
      // anchor forward to the first matching day-of-week so the parity
      // is measured from instances of the chosen day, not arbitrary dates.
      const firstMatch = startOfDayUtc(anchor);
      const anchorDow = firstMatch.getUTCDay();
      const targetDow = DAY_INDEX[schedule.dayOfWeek];
      const daysToAdd = (targetDow - anchorDow + 7) % 7;
      firstMatch.setUTCDate(firstMatch.getUTCDate() + daysToAdd);

      const diffMs = startOfDayUtc(forDate).getTime() - firstMatch.getTime();
      if (diffMs < 0) return false;
      const weeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
      return weeks % 2 === 0;
    }
    case "MONTHLY": {
      // First matching day-of-week of the month: date 1–7 inclusive.
      return forDate.getUTCDate() <= 7;
    }
    default:
      return false;
  }
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
