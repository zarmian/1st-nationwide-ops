/**
 * South Mobile shift pay. Each South Mobile rota shift an officer covers pays a
 * set amount: their own "South Mobile day shift" / "South Mobile night shift"
 * rate on Officer pay rates (unit "per shift"), else the company default.
 * North Mobile is paid by the officer's monthly retainer, so its shifts add
 * nothing here.
 *
 * A shift counts in the pay period its start falls in (09:00 for a day shift,
 * 18:00 for a night shift, UK time), so a night shift starting on the 31st is
 * paid in that month. Shifts that haven't started yet don't count, the same
 * way activity pay only counts work that's been done.
 *
 * Payroll and the payslip both use loadSouthShiftPay, so they agree.
 */
import type { RateService } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ukDayString } from "@/lib/dates";
import { addDays, dateKey, dateValue, shiftStartsAt } from "@/lib/rota";

export const SOUTH_SHIFTS = ["DAY", "NIGHT"] as const;
export type SouthShift = (typeof SOUTH_SHIFTS)[number];

/** The officer pay rate service for each South Mobile shift. */
export const SOUTH_SHIFT_SERVICE = {
  DAY: "SOUTH_MOBILE_DAY_SHIFT",
  NIGHT: "SOUTH_MOBILE_NIGHT_SHIFT",
} as const satisfies Record<SouthShift, RateService>;

export const SOUTH_SHIFT_SERVICES: readonly RateService[] = SOUTH_SHIFTS.map(
  (s) => SOUTH_SHIFT_SERVICE[s],
);

export const SOUTH_SHIFT_PAY_LABEL: Record<SouthShift, string> = {
  DAY: "South Mobile day shifts",
  NIGHT: "South Mobile night shifts",
};

export type SouthShiftPayLine = {
  shift: SouthShift;
  label: string;
  count: number;
  /** Pay per shift, or null when no rate is set (those shifts pay nothing yet). */
  rate: number | null;
  amount: number;
};

export type SouthShiftPay = {
  /** One line per kind of shift worked (day / night), in that order. */
  lines: SouthShiftPayLine[];
  shifts: number;
  amount: number;
  /** Shifts paying nothing because there's no rate for them. */
  unpricedShifts: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Price shift counts with per-shift rates. */
export function priceSouthShifts(
  counts: Record<SouthShift, number>,
  rates: Record<SouthShift, number | null>,
): SouthShiftPay {
  const lines: SouthShiftPayLine[] = SOUTH_SHIFTS.filter((s) => counts[s] > 0).map(
    (s) => ({
      shift: s,
      label: SOUTH_SHIFT_PAY_LABEL[s],
      count: counts[s],
      rate: rates[s],
      amount: round2((rates[s] ?? 0) * counts[s]),
    }),
  );
  return {
    lines,
    shifts: lines.reduce((n, l) => n + l.count, 0),
    amount: round2(lines.reduce((n, l) => n + l.amount, 0)),
    unpricedShifts: lines
      .filter((l) => l.rate == null)
      .reduce((n, l) => n + l.count, 0),
  };
}

export type RateRow = { officerId: string | null; service: string; amount: unknown };

/** The officer's own rate for a South shift, else the company default. */
export function southShiftRate(
  rates: readonly RateRow[],
  officerId: string,
  shift: SouthShift,
): number | null {
  const service = SOUTH_SHIFT_SERVICE[shift];
  const pick =
    rates.find((r) => r.officerId === officerId && r.service === service) ??
    rates.find((r) => r.officerId === null && r.service === service);
  return pick ? Number(pick.amount) : null;
}

/** Whether a South shift on `day` counts in the window [from, to] as at `now`. */
export function countsInWindow(
  day: string,
  shift: SouthShift,
  from: Date,
  to: Date,
  now: Date,
): boolean {
  const starts = shiftStartsAt(day, shift);
  return starts >= from && starts <= to && starts <= now;
}

/**
 * South Mobile shift pay per officer for the window [from, to]. Officers with
 * no South shifts in it are left out of the map.
 */
export async function loadSouthShiftPay(
  from: Date,
  to: Date,
  opts: { officerId?: string; now?: Date } = {},
): Promise<Map<string, SouthShiftPay>> {
  const now = opts.now ?? new Date();
  // Rota rows are dated by UK day: read a day either side, then keep the
  // shifts whose start is inside the window.
  const rows = await prisma.rotaAssignment.findMany({
    where: {
      patrol: "SOUTH_MOBILE",
      shift: { in: [...SOUTH_SHIFTS] },
      date: {
        gte: dateValue(addDays(ukDayString(from), -1)),
        lte: dateValue(addDays(ukDayString(to), 1)),
      },
      ...(opts.officerId ? { officerId: opts.officerId } : {}),
    },
    select: { officerId: true, date: true, shift: true },
  });

  const counts = new Map<string, Record<SouthShift, number>>();
  for (const r of rows) {
    const shift = r.shift as SouthShift;
    if (!countsInWindow(dateKey(r.date), shift, from, to, now)) continue;
    const c = counts.get(r.officerId) ?? { DAY: 0, NIGHT: 0 };
    c[shift] += 1;
    counts.set(r.officerId, c);
  }
  if (counts.size === 0) return new Map();

  const rates = await prisma.officerRate.findMany({
    where: {
      service: { in: [...SOUTH_SHIFT_SERVICES] },
      OR: [{ officerId: null }, { officerId: { in: [...counts.keys()] } }],
    },
    select: { officerId: true, service: true, amount: true },
  });

  const out = new Map<string, SouthShiftPay>();
  for (const [officerId, c] of counts) {
    out.set(
      officerId,
      priceSouthShifts(c, {
        DAY: southShiftRate(rates, officerId, "DAY"),
        NIGHT: southShiftRate(rates, officerId, "NIGHT"),
      }),
    );
  }
  return out;
}
