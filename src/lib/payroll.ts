/**
 * Payroll roll-up helpers. Pure-ish — uses prisma but the shaping logic is
 * isolated so we can unit-test the formatter (csvLineFor) without a DB.
 *
 * Roll-up rules:
 *   1. Activity pay: sum of `paidAmount` across PatrolVisits + Jobs the
 *      officer attended, where `paidAt` falls in [from, to].
 *   2. Monthly retainer: if the officer has an OfficerRate with service
 *      MONTHLY_… wait — we use service ANNUAL_SUBSCRIPTION on SiteRate as
 *      the "monthly retainer" service on OfficerRate (see migration notes).
 *      Look it up by the per-officer rate first, falling back to a company
 *      default. Multiplied by the number of whole months in the period.
 *
 * Outputs one row per active officer/dispatcher, even those with zero pay,
 * so admin can see who's missing from the run.
 */
import { prisma } from "@/lib/db";

export type PayrollRow = {
  officerId: string;
  name: string;
  email: string;
  role: string;
  siaNumber: string | null;
  retainerAmount: number;
  retainerCurrency: string;
  retainerMonths: number;
  activityPay: number;
  activityCount: number;
  total: number;
  currency: string;
};

export type PayrollReport = {
  from: Date;
  to: Date;
  rows: PayrollRow[];
  totals: {
    retainer: number;
    activityPay: number;
    grand: number;
  };
};

/**
 * Whole months spanned by [from, to]. Anchored on the from-month so that
 * picking 1 May → 31 May returns 1, 1 May → 30 Jun returns 2, etc.
 *
 * Partial months at the start / end count as a full month for retainer
 * purposes — common payroll convention for fixed standing charges.
 */
export function monthsBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  const months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth()) +
    1;
  return Math.max(1, months);
}

export async function buildPayrollReport(
  from: Date,
  to: Date,
): Promise<PayrollReport> {
  // Active officers + dispatchers — we pay both.
  const officers = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["OFFICER", "DISPATCHER"] },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      siaNumber: true,
    },
  });

  // All retainer rates in one go (company default + per-officer).
  // Monthly retainer is stored as service "MONTHLY_RETAINER" on OfficerRate.
  // Older deployments may have used "ANNUAL_SUBSCRIPTION" with unit
  // PER_MONTH — we accept both so the report doesn't go to zero on legacy
  // data.
  const retainerRates = await prisma.officerRate.findMany({
    where: {
      OR: [{ unit: "PER_MONTH" }, { service: "ANNUAL_SUBSCRIPTION" as any }],
    },
    select: {
      id: true,
      officerId: true,
      amount: true,
      currency: true,
      unit: true,
      service: true,
    },
  });
  const defaultRetainer = retainerRates.find(
    (r) => r.officerId === null && r.unit === "PER_MONTH",
  );
  const perOfficerRetainer = new Map<string, (typeof retainerRates)[number]>();
  for (const r of retainerRates) {
    if (r.officerId && r.unit === "PER_MONTH") {
      perOfficerRetainer.set(r.officerId, r);
    }
  }

  // Paid totals per officer over the period. Visits → officerId; Jobs →
  // assignedToUserId. groupBy doesn't compose inside $transaction's array
  // form, so we await sequentially — one connection still, same effect.
  const visitPay = await prisma.patrolVisit.groupBy({
    by: ["officerId"],
    where: {
      officerId: { not: null },
      paidAt: { gte: from, lte: to },
    },
    _sum: { paidAmount: true },
    _count: { _all: true },
    orderBy: { officerId: "asc" },
  });
  const jobPay = await prisma.job.groupBy({
    by: ["assignedToUserId"],
    where: {
      assignedToUserId: { not: null },
      paidAt: { gte: from, lte: to },
    },
    _sum: { paidAmount: true },
    _count: { _all: true },
    orderBy: { assignedToUserId: "asc" },
  });
  const payByOfficer = new Map<
    string,
    { amount: number; count: number; currency: string }
  >();
  for (const v of visitPay) {
    if (!v.officerId) continue;
    payByOfficer.set(v.officerId, {
      amount: Number(v._sum.paidAmount ?? 0),
      count: v._count._all,
      currency: "GBP",
    });
  }
  for (const j of jobPay) {
    if (!j.assignedToUserId) continue;
    const cur = payByOfficer.get(j.assignedToUserId) ?? {
      amount: 0,
      count: 0,
      currency: "GBP",
    };
    cur.amount += Number(j._sum.paidAmount ?? 0);
    cur.count += j._count._all;
    payByOfficer.set(j.assignedToUserId, cur);
  }

  const months = monthsBetween(from, to);

  const rows: PayrollRow[] = officers.map((o) => {
    const retainer =
      perOfficerRetainer.get(o.id) ??
      (defaultRetainer ?? null);
    const retainerAmount = retainer ? Number(retainer.amount) * months : 0;
    const retainerCurrency = retainer?.currency ?? "GBP";
    const activity = payByOfficer.get(o.id);
    const activityPay = activity?.amount ?? 0;
    const activityCount = activity?.count ?? 0;
    const total = retainerAmount + activityPay;
    return {
      officerId: o.id,
      name: o.name,
      email: o.email,
      role: o.role,
      siaNumber: o.siaNumber,
      retainerAmount: round2(retainerAmount),
      retainerCurrency,
      retainerMonths: months,
      activityPay: round2(activityPay),
      activityCount,
      total: round2(total),
      currency: retainerCurrency,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      retainer: acc.retainer + r.retainerAmount,
      activityPay: acc.activityPay + r.activityPay,
      grand: acc.grand + r.total,
    }),
    { retainer: 0, activityPay: 0, grand: 0 },
  );

  return { from, to, rows, totals };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One CSV row per officer. Escaping is conservative — quote every field
 * and double up any internal quotes — so the output round-trips through
 * Excel and Google Sheets cleanly.
 */
export function csvLineFor(row: PayrollRow): string {
  const cells = [
    row.officerId,
    row.name,
    row.email,
    row.role,
    row.siaNumber ?? "",
    row.retainerAmount.toFixed(2),
    String(row.retainerMonths),
    row.activityPay.toFixed(2),
    String(row.activityCount),
    row.total.toFixed(2),
    row.currency,
  ];
  return cells.map(csvCell).join(",");
}

export function csvHeader(): string {
  return [
    "officer_id",
    "name",
    "email",
    "role",
    "sia_number",
    "retainer_amount",
    "retainer_months",
    "activity_pay",
    "activity_count",
    "total",
    "currency",
  ]
    .map(csvCell)
    .join(",");
}

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
