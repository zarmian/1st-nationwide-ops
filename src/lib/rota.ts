/**
 * The mobile patrol rota: the patrols, their shifts and hours, which shifts
 * overlap, and who counts as available. No database here — shared by the
 * rota board, the officer's own rota page, the rota actions and payroll.
 *
 *   North Mobile — one 24-hour shift a day, 09:00 to 09:00 the next day.
 *   South Mobile — a day shift, 09:00–18:00, and a night shift, 18:00 to
 *                  09:00 the next day.
 *
 * Every rota row is dated by the UK day its shift starts. Officers mark
 * themselves available by half: Day (09:00–18:00) and Night (18:00–09:00).
 * The 24-hour North shift needs both.
 *
 * Pay: North Mobile stays on the officer's monthly retainer. Each South
 * Mobile shift pays a set amount (src/lib/rotaPay.ts).
 */
import { ukWallClockToUtc } from "@/lib/dates";

export const ROTA_PATROLS = ["NORTH_MOBILE", "SOUTH_MOBILE"] as const;
export type RotaPatrolCode = (typeof ROTA_PATROLS)[number];

export const ROTA_SHIFTS = ["DAY", "NIGHT", "FULL_DAY"] as const;
export type RotaShiftCode = (typeof ROTA_SHIFTS)[number];

/** The halves an officer can mark themselves available for. */
export const AVAILABILITY_SHIFTS = ["DAY", "NIGHT"] as const;
export type AvailabilityShift = (typeof AVAILABILITY_SHIFTS)[number];

export const PATROL_LABEL: Record<RotaPatrolCode, string> = {
  NORTH_MOBILE: "North Mobile",
  SOUTH_MOBILE: "South Mobile",
};

export const SHIFT_LABEL: Record<RotaShiftCode, string> = {
  DAY: "Day shift",
  NIGHT: "Night shift",
  FULL_DAY: "24 hours",
};

/** Availability halves as officers see them on /m/rota. */
export const HALF_LABEL: Record<AvailabilityShift, string> = {
  DAY: "Day",
  NIGHT: "Night",
};

type Hours = { start: string; end: string; endsNextDay: boolean };

/** Hours of each shift, UK wall clock. Availability halves use DAY / NIGHT. */
export const SHIFT_HOURS: Record<RotaShiftCode, Hours> = {
  DAY: { start: "09:00", end: "18:00", endsNextDay: false },
  NIGHT: { start: "18:00", end: "09:00", endsNextDay: true },
  FULL_DAY: { start: "09:00", end: "09:00", endsNextDay: true },
};

export type RotaSlot = {
  patrol: RotaPatrolCode;
  shift: RotaShiftCode;
  /** Halves an officer must have marked to count as available for it. */
  needs: readonly AvailabilityShift[];
};

/** Every shift on the rota, in the order the board shows them. */
export const ROTA_SLOTS: readonly RotaSlot[] = [
  { patrol: "NORTH_MOBILE", shift: "FULL_DAY", needs: ["DAY", "NIGHT"] },
  { patrol: "SOUTH_MOBILE", shift: "DAY", needs: ["DAY"] },
  { patrol: "SOUTH_MOBILE", shift: "NIGHT", needs: ["NIGHT"] },
];

/** The rota shift for a patrol + shift pair, or null if there's no such shift. */
export function rotaSlot(patrol: string, shift: string): RotaSlot | null {
  return ROTA_SLOTS.find((s) => s.patrol === patrol && s.shift === shift) ?? null;
}

/** "09:00–18:00" or "18:00–09:00 next day". */
export function shiftHours(shift: RotaShiftCode): string {
  const h = SHIFT_HOURS[shift];
  return `${h.start}–${h.end}${h.endsNextDay ? " next day" : ""}`;
}

/** "South Mobile, night shift" */
export function slotName(patrol: RotaPatrolCode, shift: RotaShiftCode): string {
  return `${PATROL_LABEL[patrol]}, ${SHIFT_LABEL[shift].toLowerCase()}`;
}

/** Which availability halves a rota shift takes up. */
export function halvesOf(shift: RotaShiftCode): AvailabilityShift[] {
  return shift === "FULL_DAY" ? ["DAY", "NIGHT"] : [shift];
}

export type Availability = "full" | "partial" | "none";

/** How far the halves an officer marked cover a rota shift. */
export function availabilityFor(
  slot: RotaSlot,
  marked: Iterable<AvailabilityShift>,
): Availability {
  const set = new Set(marked);
  const have = slot.needs.filter((n) => set.has(n)).length;
  if (have === slot.needs.length) return "full";
  return have > 0 ? "partial" : "none";
}

// ── Dates ───────────────────────────────────────────────────────────────────
// Rota dates are "YYYY-MM-DD" UK calendar days. In the database they're DATE
// columns, which Prisma reads and writes as UTC midnight.

/** "YYYY-MM-DD" of a DATE column value. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** DATE column value for a "YYYY-MM-DD" day. */
export function dateValue(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** The "YYYY-MM-DD" day `n` days after `day` (negative goes back). */
export function addDays(day: string, n: number): string {
  const d = dateValue(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}

/** "Mon 24 Nov" for a "YYYY-MM-DD" day. */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(dateValue(day));
}

/** Monday of the week `day` falls in. */
export function mondayOf(day: string): string {
  const dow = (dateValue(day).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(day, -dow);
}

/** When a rota shift starts, as a UTC instant (UK wall clock, DST-aware). */
export function shiftStartsAt(day: string, shift: RotaShiftCode): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = SHIFT_HOURS[shift].start.split(":").map(Number);
  return ukWallClockToUtc(y!, m!, d!, hh!, mm!);
}

// ── Overlaps ────────────────────────────────────────────────────────────────

const MIN_PER_DAY = 24 * 60;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function daysBetween(a: string, b: string): number {
  return Math.round((dateValue(b).getTime() - dateValue(a).getTime()) / 86_400_000);
}

/** A shift's [start, end) in wall-clock minutes from midnight on `origin`. */
function span(day: string, shift: RotaShiftCode, origin: string): [number, number] {
  const h = SHIFT_HOURS[shift];
  const offset = daysBetween(origin, day) * MIN_PER_DAY;
  return [
    offset + minutesOf(h.start),
    offset + minutesOf(h.end) + (h.endsNextDay ? MIN_PER_DAY : 0),
  ];
}

export type DatedShift = { date: string; shift: RotaShiftCode };

/**
 * Whether two rota shifts overlap in time, so one officer can't do both.
 * Back-to-back shifts (one ends at 09:00, the next starts at 09:00) don't.
 */
export function shiftsOverlap(a: DatedShift, b: DatedShift): boolean {
  const [aStart, aEnd] = span(a.date, a.shift, a.date);
  const [bStart, bEnd] = span(b.date, b.shift, a.date);
  return aStart < bEnd && bStart < aEnd;
}
