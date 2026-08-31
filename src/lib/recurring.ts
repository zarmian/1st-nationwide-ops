/**
 * Recurring / subscription billing. A RecurringCharge produces one
 * RecurringChargeRun per period it's due; those runs are picked up by the
 * customer's next invoice (see lib/invoicing.ts) and stamped with its id, so a
 * period is never billed twice. Voiding an invoice deletes its runs.
 *
 * `dueRecurringLines` returns the periods that are due in a window and NOT yet
 * run — the invoice preview shows them, and invoice creation materialises them.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Client = Prisma.TransactionClient | typeof prisma;

type ChargeForDue = {
  id: string;
  description: string;
  service: string | null;
  amount: Prisma.Decimal | number;
  cadence: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONE_OFF";
  startDate: Date;
  endDate: Date | null;
};

const monthKey = (y: number, m0: number) =>
  `${y}-${String(m0 + 1).padStart(2, "0")}`;

/** Calendar months overlapping [from, to], inclusive. */
function* overlappingMonths(from: Date, to: Date) {
  let y = from.getFullYear();
  let m0 = from.getMonth();
  const endY = to.getFullYear();
  const endM0 = to.getMonth();
  while (y < endY || (y === endY && m0 <= endM0)) {
    yield {
      y,
      m0,
      start: new Date(y, m0, 1),
      end: new Date(y, m0 + 1, 0, 23, 59, 59, 999),
    };
    m0 += 1;
    if (m0 > 11) {
      m0 = 0;
      y += 1;
    }
  }
}

/** Period keys a charge is due for within [from, to] (before de-duping runs). */
export function periodsDue(
  charge: ChargeForDue,
  from: Date,
  to: Date,
): { periodKey: string; periodStart: Date }[] {
  const out: { periodKey: string; periodStart: Date }[] = [];
  const cs = charge.startDate;
  const ce = charge.endDate;
  for (const mo of overlappingMonths(from, to)) {
    if (mo.end < cs) continue; // month entirely before the charge starts
    if (ce && mo.start > ce) continue; // month entirely after it ends
    switch (charge.cadence) {
      case "MONTHLY":
        out.push({ periodKey: monthKey(mo.y, mo.m0), periodStart: mo.start });
        break;
      case "QUARTERLY":
        if (mo.m0 % 3 === 0)
          out.push({ periodKey: `${mo.y}-Q${mo.m0 / 3 + 1}`, periodStart: mo.start });
        break;
      case "ANNUAL":
        if (mo.m0 === cs.getMonth())
          out.push({ periodKey: `${mo.y}`, periodStart: mo.start });
        break;
      case "ONE_OFF":
        if (mo.start <= cs && cs <= mo.end)
          out.push({ periodKey: "ONEOFF", periodStart: mo.start });
        break;
    }
  }
  return out;
}

export type DueRecurring = {
  lines: { service: string | null; description: string; amount: number }[];
  runs: { chargeId: string; periodKey: string; amount: number }[];
};

/** Active recurring charges due (and not yet run) for a customer in a window. */
export async function dueRecurringLines(
  db: Client,
  customerId: string,
  from: Date,
  to: Date,
): Promise<DueRecurring> {
  const charges = await db.recurringCharge.findMany({
    where: { customerId, active: true },
    include: { runs: { select: { periodKey: true } } },
  });

  const lines: DueRecurring["lines"] = [];
  const runs: DueRecurring["runs"] = [];

  for (const c of charges) {
    const seen = new Set(c.runs.map((r) => r.periodKey));
    const due = periodsDue(c, from, to).filter((p) => !seen.has(p.periodKey));
    const amount = Number(c.amount);
    for (const p of due) {
      const suffix = p.periodKey === "ONEOFF" ? "" : ` (${p.periodKey})`;
      lines.push({
        service: c.service,
        description: `${c.description}${suffix}`,
        amount,
      });
      runs.push({ chargeId: c.id, periodKey: p.periodKey, amount });
    }
  }
  return { lines, runs };
}
