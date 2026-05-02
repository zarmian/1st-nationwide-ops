/**
 * Helpers for figuring out whether a given PatrolSchedule should produce
 * a visit on a given date.
 *
 * Conventions:
 * - dayOfWeek match is straightforward.
 * - WEEKLY  → every matching day-of-week.
 * - FORTNIGHTLY → every other matching day-of-week, anchored on the
 *   schedule's startsOn (or the first matching day from the schedule's
 *   createdAt if startsOn is null).
 * - MONTHLY → the first matching day-of-week within the calendar month.
 *
 * Times: schedules don't carry an explicit time-of-day yet, so we default
 * patrol visits to 22:00 UTC (typical night start). VPI visits use 09:00.
 */

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
  },
  forDate: Date,
): boolean {
  const day = forDate.getUTCDay();
  if (DAY_INDEX[schedule.dayOfWeek] !== day) return false;

  // Fortnightly anchor falls back to the epoch when no startsOn — keeps
  // the parity stable across days/runs.
  const startsOn = schedule.startsOn ?? new Date(0);
  if (schedule.startsOn && forDate < startOfDayUtc(schedule.startsOn))
    return false;
  if (schedule.endsOn && forDate > endOfDayUtc(schedule.endsOn)) return false;

  switch (schedule.frequency) {
    case "WEEKLY":
      return true;
    case "FORTNIGHTLY": {
      // Number of whole weeks since the anchor; even = matching, odd = skip.
      const diffMs = forDate.getTime() - startOfDayUtc(startsOn).getTime();
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
      return weeks >= 0 && weeks % 2 === 0;
    }
    case "MONTHLY": {
      // First matching day-of-week of the month: date 1–7 inclusive.
      return forDate.getUTCDate() <= 7;
    }
    default:
      return false;
  }
}

export function defaultScheduledAt(forDate: Date, kind: string): Date {
  const d = new Date(forDate);
  d.setUTCHours(kind === "VPI" ? 9 : 22, 0, 0, 0);
  return d;
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
