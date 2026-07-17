/**
 * Canonical "when" for an activity across the whole app.
 *
 * Business rule (set by the operator): every activity list shows, and every
 * finance/payroll window filters by, the SCHEDULED date — the rota date —
 * falling back to completion only when there's no schedule (ad-hoc callouts).
 * So a job/patrol/shift scheduled for the 30th but finished on the 1st still
 * reads and counts on the 30th.
 *
 *  - Job   → scheduledFor  (else completedAt / startedAt)
 *  - Visit → scheduledAt   (its scheduleDate = the night it was set for is
 *                           the accounting anchor for month windows)
 *  - Shift → scheduledStartsAt
 */

// ── Display: the date/time a row should show ──────────────────────────────

export function jobWhen(j: {
  scheduledFor?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date | null;
}): Date | null {
  return j.scheduledFor ?? j.startedAt ?? j.completedAt ?? j.createdAt ?? null;
}

export function visitWhen(v: {
  scheduledAt: Date;
}): Date {
  return v.scheduledAt;
}

export function shiftWhen(s: { scheduledStartsAt: Date }): Date {
  return s.scheduledStartsAt;
}

// ── Filtering: Prisma where-fragments for a scheduled-date window ──────────
// Spread into a where that does NOT already declare a top-level `OR`.

export function jobScheduledRange(from: Date, to: Date) {
  return {
    OR: [
      { scheduledFor: { gte: from, lte: to } },
      { scheduledFor: null, completedAt: { gte: from, lte: to } },
    ],
  };
}

export function visitScheduledRange(from: Date, to: Date) {
  return {
    OR: [
      { scheduleDate: { gte: from, lte: to } },
      { scheduleDate: null, scheduledAt: { gte: from, lte: to } },
    ],
  };
}

export function shiftScheduledRange(from: Date, to: Date) {
  return { scheduledStartsAt: { gte: from, lte: to } };
}
