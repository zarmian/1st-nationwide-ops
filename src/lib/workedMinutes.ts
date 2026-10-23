/**
 * How long a guarding shift ran — one rule shared by invoices and the client
 * portal, so the hours a client sees agree with the hours they're billed for.
 */

/** Worked minutes for a shift — actual time, falling back to scheduled. */
export function shiftWorkedMinutes(s: {
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  payableMinutes: number | null;
}): number {
  if (s.actualStartedAt && s.actualEndedAt) {
    return Math.max(
      0,
      (s.actualEndedAt.getTime() - s.actualStartedAt.getTime()) / 60000,
    );
  }
  if (s.scheduledStartsAt && s.scheduledEndsAt) {
    return Math.max(
      0,
      (s.scheduledEndsAt.getTime() - s.scheduledStartsAt.getTime()) / 60000,
    );
  }
  return s.payableMinutes ?? 0;
}

/**
 * Minutes on site for guarding recorded as a job (no booked end time): from
 * the start (or the scheduled time) to completion. Null when either end is
 * missing, or the gap is over a day — that's a job closed off late, not a
 * day's guarding.
 */
export function guardJobMinutes(j: {
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}): number | null {
  const start = j.startedAt ?? j.scheduledFor;
  if (!start || !j.completedAt) return null;
  const mins = (j.completedAt.getTime() - start.getTime()) / 60000;
  return mins > 0 && mins <= 24 * 60 ? mins : null;
}
