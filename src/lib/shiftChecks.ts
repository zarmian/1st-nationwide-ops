/**
 * Shift check-in scheduling.
 *
 * A running shift has a check-in "due" every `checkIntervalMin` minutes after
 * it starts. Each check-in is only actionable inside a window that opens
 * CHECKIN_LEAD_MIN minutes before it's due and closes when the buffer
 * (`graceMin`) runs out:
 *
 *     opensAt = dueAt - 10 min          closesAt = dueAt + graceMin
 *
 * Pure + unit-tested — used server-side (authoritative enforcement in
 * checkInDuty) and client-side (the duty runner enables the button + shows the
 * countdown). No DB or clock access; callers pass `now`.
 */

export const CHECKIN_LEAD_MIN = 10;

export type CheckSlot = {
  /** 1-based sequence number of the check-in within the shift. */
  index: number;
  dueAt: Date;
  opensAt: Date;
  closesAt: Date;
};

export function computeCheckSlots(opts: {
  /** When the cadence starts — the actual start, else the scheduled start. */
  startBasis: Date;
  /** The scheduled end — no check-in is due at or after it. */
  endBasis: Date;
  intervalMin: number;
  graceMin: number;
}): CheckSlot[] {
  const interval = Math.max(1, Math.round(opts.intervalMin)) * 60_000;
  const grace = Math.max(0, Math.round(opts.graceMin)) * 60_000;
  const lead = CHECKIN_LEAD_MIN * 60_000;
  const startMs = opts.startBasis.getTime();
  const endMs = opts.endBasis.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const slots: CheckSlot[] = [];
  let index = 1;
  // First check-in one interval in; last one strictly before the end.
  for (let due = startMs + interval; due < endMs; due += interval) {
    slots.push({
      index,
      dueAt: new Date(due),
      opensAt: new Date(due - lead),
      closesAt: new Date(due + grace),
    });
    index += 1;
  }
  return slots;
}

/** The slot whose window currently contains `now` (earliest if they overlap). */
export function openSlotAt(slots: CheckSlot[], now: Date): CheckSlot | null {
  const t = now.getTime();
  return (
    slots.find((s) => t >= s.opensAt.getTime() && t <= s.closesAt.getTime()) ??
    null
  );
}

/** The next slot that hasn't opened yet (null when none remain). */
export function nextSlotAfter(slots: CheckSlot[], now: Date): CheckSlot | null {
  const t = now.getTime();
  return slots.find((s) => t < s.opensAt.getTime()) ?? null;
}

/**
 * Slots whose window has fully closed with no matching check-in — i.e. missed.
 * `doneIndices` is the set of slot indexes that were checked in.
 */
export function missedSlots(
  slots: CheckSlot[],
  doneIndices: Set<number>,
  now: Date,
): CheckSlot[] {
  const t = now.getTime();
  return slots.filter(
    (s) => t > s.closesAt.getTime() && !doneIndices.has(s.index),
  );
}
