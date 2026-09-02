/**
 * A forward cash-flow forecast — money in vs money out over the coming weeks,
 * with a running position, so you can see whether you'll cover payroll and spot
 * a squeeze early.
 *
 * What's modelled (the concrete, known items):
 *   In  — outstanding customer invoices, expected on their due date (overdue
 *         ones land in the first week).
 *   Out — unpaid supplier bills on their due date, plus a monthly payroll
 *         estimate (last calendar month's payroll total) on each month-end.
 *
 * Not modelled: VAT payments, un-invoiced recurring revenue, ad-hoc costs — the
 * page says so. There's no bank feed, so the running balance starts from an
 * opening figure you provide (default £0) and shows the cumulative movement.
 */
import { loadReceivables } from "@/lib/receivables";
import { loadPayables } from "@/lib/payables";
import { type HiddenScope } from "@/lib/hiddenAccounts";
import { buildPayrollReport } from "@/lib/payroll";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const round2 = (n: number) => Math.round(n * 100) / 100;

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mondayOffset = (x.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  x.setDate(x.getDate() - mondayOffset);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export type CashflowWeek = {
  start: Date;
  inflow: number;
  outflow: number;
  net: number;
  /** Running position at the end of this week (opening + cumulative net). */
  balance: number;
};

export type CashflowForecast = {
  from: Date;
  weeks: CashflowWeek[];
  opening: number;
  totalIn: number;
  totalOut: number;
  net: number;
  /** Lowest running balance across the window — the tightest point. */
  lowestBalance: number;
  lowestWeekStart: Date | null;
  monthlyPayroll: number;
};

export async function loadCashflow(
  asOf: Date = new Date(),
  weeksCount = 12,
  opening = 0,
  hidden?: HiddenScope,
): Promise<CashflowForecast> {
  const wkStart = startOfWeek(asOf);
  const windowEnd = addDays(wkStart, weeksCount * 7);

  // Monthly payroll estimate = last calendar month's grand total.
  const lastMonthStart = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  const lastMonthEnd = new Date(
    asOf.getFullYear(),
    asOf.getMonth(),
    0,
    23,
    59,
    59,
    999,
  );

  const [receivables, payables, payroll] = await Promise.all([
    loadReceivables(asOf, hidden),
    loadPayables(asOf, hidden),
    buildPayrollReport(lastMonthStart, lastMonthEnd),
  ]);
  const monthlyPayroll = round2(payroll.totals.grand);

  const weeks: CashflowWeek[] = Array.from({ length: weeksCount }, (_, i) => ({
    start: addDays(wkStart, i * 7),
    inflow: 0,
    outflow: 0,
    net: 0,
    balance: 0,
  }));

  // Bucket a date into a week index; anything on/before now → week 0.
  const idxFor = (d: Date): number => {
    const diff = Math.floor((d.getTime() - wkStart.getTime()) / WEEK_MS);
    return Math.max(0, Math.min(weeksCount - 1, diff));
  };

  // Money in — outstanding invoices on their due date.
  for (const r of receivables.rows) {
    weeks[idxFor(r.dueAt ?? asOf)].inflow += r.balance;
  }

  // Money out — unpaid supplier bills on their due date.
  for (const p of payables.rows) {
    weeks[idxFor(p.dueDate)].outflow += p.gross;
  }

  // Money out — payroll on each month-end within the window.
  if (monthlyPayroll > 0) {
    let cursor = new Date(wkStart.getFullYear(), wkStart.getMonth() + 1, 0); // this month-end
    while (cursor < windowEnd) {
      if (cursor >= wkStart) weeks[idxFor(cursor)].outflow += monthlyPayroll;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0); // next month-end
    }
  }

  let balance = opening;
  let lowestBalance = Infinity;
  let lowestWeekStart: Date | null = null;
  let totalIn = 0;
  let totalOut = 0;
  for (const w of weeks) {
    w.inflow = round2(w.inflow);
    w.outflow = round2(w.outflow);
    w.net = round2(w.inflow - w.outflow);
    balance = round2(balance + w.net);
    w.balance = balance;
    totalIn += w.inflow;
    totalOut += w.outflow;
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestWeekStart = w.start;
    }
  }

  return {
    from: wkStart,
    weeks,
    opening,
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    net: round2(totalIn - totalOut),
    lowestBalance: Number.isFinite(lowestBalance) ? lowestBalance : opening,
    lowestWeekStart,
    monthlyPayroll,
  };
}
