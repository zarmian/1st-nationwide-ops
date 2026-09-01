/**
 * Management P&L for a period — a formal profit statement:
 *
 *   Revenue                     (billed activity, by scheduled date)
 *     less Officer pay          (paidAmount on our own attended work)
 *     less Subcontractors       (partnerChargeToUsAmount — partner work for us)
 *   = Gross profit
 *     less Overheads            (supplier costs, net, by bill date)
 *   = Net profit
 *
 * Reads the frozen per-activity snapshots and the supplier-cost ledger; it never
 * re-prices. Figures are attributed on the same scheduled-date basis as the rest
 * of finance, so a job for the 30th counts in that month even if closed on the
 * 1st.
 */
import { prisma } from "@/lib/db";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

const round2 = (n: number) => Math.round(n * 100) / 100;

const RATE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  KEYHOLDING: "Keyholding",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  PATROL: "Patrol",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key dropoff",
  ADHOC: "Ad-hoc",
};

export type PnlFigures = {
  revenue: number;
  officerPay: number;
  subcontractors: number;
  grossProfit: number;
  overheads: number;
  netProfit: number;
};

export type PnlReport = {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  current: PnlFigures;
  previous: PnlFigures;
  revenueByService: { label: string; value: number }[];
};

async function figuresFor(from: Date, to: Date): Promise<PnlFigures> {
  const [v, j, s, costs] = await Promise.all([
    prisma.patrolVisit.aggregate({
      where: { status: "COMPLETED", ...visitScheduledRange(from, to) },
      _sum: {
        billedAmount: true,
        paidAmount: true,
        partnerChargeToUsAmount: true,
      },
    }),
    prisma.job.aggregate({
      where: {
        status: { not: "CANCELLED" },
        completedAt: { not: null },
        ...jobScheduledRange(from, to),
      },
      _sum: {
        billedAmount: true,
        paidAmount: true,
        partnerChargeToUsAmount: true,
      },
    }),
    prisma.shift.aggregate({
      where: { status: "COMPLETED", ...shiftScheduledRange(from, to) },
      _sum: {
        billedAmount: true,
        paidAmount: true,
        partnerChargeToUsAmount: true,
      },
    }),
    prisma.supplierCost.aggregate({
      where: { date: { gte: from, lte: to } },
      _sum: { net: true },
    }),
  ]);

  const revenue = round2(
    Number(v._sum.billedAmount ?? 0) +
      Number(j._sum.billedAmount ?? 0) +
      Number(s._sum.billedAmount ?? 0),
  );
  const officerPay = round2(
    Number(v._sum.paidAmount ?? 0) +
      Number(j._sum.paidAmount ?? 0) +
      Number(s._sum.paidAmount ?? 0),
  );
  const subcontractors = round2(
    Number(v._sum.partnerChargeToUsAmount ?? 0) +
      Number(j._sum.partnerChargeToUsAmount ?? 0) +
      Number(s._sum.partnerChargeToUsAmount ?? 0),
  );
  const overheads = round2(Number(costs._sum.net ?? 0));
  const grossProfit = round2(revenue - officerPay - subcontractors);
  const netProfit = round2(grossProfit - overheads);
  return { revenue, officerPay, subcontractors, grossProfit, overheads, netProfit };
}

async function revenueByService(
  from: Date,
  to: Date,
): Promise<{ label: string; value: number }[]> {
  const [visits, jobs, shifts] = await Promise.all([
    prisma.patrolVisit.findMany({
      where: { status: "COMPLETED", ...visitScheduledRange(from, to) },
      select: { billedAmount: true, patrolSchedule: { select: { kind: true } } },
    }),
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        completedAt: { not: null },
        ...jobScheduledRange(from, to),
      },
      select: { billedAmount: true, type: true, typeLabel: true },
    }),
    prisma.shift.findMany({
      where: { status: "COMPLETED", ...shiftScheduledRange(from, to) },
      select: { billedAmount: true, type: true },
    }),
  ]);
  const map = new Map<string, number>();
  const add = (label: string, amt: number) =>
    map.set(label, (map.get(label) ?? 0) + amt);
  for (const v of visits)
    add(v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol", Number(v.billedAmount ?? 0));
  for (const jb of jobs)
    add(jb.typeLabel ?? RATE_LABEL[jb.type] ?? jb.type, Number(jb.billedAmount ?? 0));
  for (const sh of shifts)
    add(RATE_LABEL[sh.type] ?? sh.type, Number(sh.billedAmount ?? 0));
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: round2(value) }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value);
}

export async function loadPnl(from: Date, to: Date): Promise<PnlReport> {
  // Previous period: same length, ending the moment before `from`.
  const periodMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  const [current, previous, rbs] = await Promise.all([
    figuresFor(from, to),
    figuresFor(prevFrom, prevTo),
    revenueByService(from, to),
  ]);

  return { from, to, prevFrom, prevTo, current, previous, revenueByService: rbs };
}
