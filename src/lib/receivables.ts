/**
 * Accounts receivable — what customers owe us right now, aged by how long each
 * invoice has been overdue.
 *
 * "Outstanding" = issued invoices (status SENT) with a positive balance, where
 *   balance = total − sum(payments received).
 * DRAFT invoices aren't owed yet; PAID are settled; VOID are cancelled — none
 * count. A part-paid invoice stays SENT with a smaller balance until covered.
 *
 * Ageing buckets are relative to the invoice due date: not-yet-due invoices sit
 * in "current"; overdue ones fall into 1–30 / 31–60 / 61–90 / 90+ days.
 */
import { prisma } from "@/lib/db";

export type AgedBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const BUCKET_ORDER: AgedBucket[] = [
  "current",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
];

export const BUCKET_LABEL: Record<AgedBucket, string> = {
  current: "Not yet due",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

export type Receivable = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  total: number;
  paid: number;
  balance: number;
  /** Whole days past the due date; ≤ 0 when not yet due. */
  daysOverdue: number;
  bucket: AgedBucket;
};

export type ReceivablesSummary = {
  asOf: Date;
  rows: Receivable[];
  totalOutstanding: number;
  /** Outstanding balance summed within each ageing bucket. */
  buckets: Record<AgedBucket, number>;
  /** Per-customer outstanding balance, largest first. */
  byCustomer: { customerId: string; customerName: string; balance: number }[];
  count: number;
};

const DAY_MS = 86_400_000;

/** Which ageing bucket a balance sits in, given whole days past its due date. */
export function ageBucket(daysOverdue: number): AgedBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

export async function loadReceivables(
  asOf: Date = new Date(),
): Promise<ReceivablesSummary> {
  const invoices = await prisma.invoice.findMany({
    where: { status: "SENT" },
    include: {
      customer: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  const buckets: Record<AgedBucket, number> = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  };
  const byCustomer = new Map<string, { customerId: string; customerName: string; balance: number }>();

  const rows: Receivable[] = [];
  for (const inv of invoices) {
    const total = Number(inv.total);
    const paid = inv.payments.reduce((n, p) => n + Number(p.amount), 0);
    const balance = Math.round((total - paid) * 100) / 100;
    // Ignore fully-settled invoices that haven't yet been flipped to PAID, and
    // guard against tiny floating remainders.
    if (balance <= 0.009) continue;

    const daysOverdue = inv.dueAt
      ? Math.floor((asOf.getTime() - inv.dueAt.getTime()) / DAY_MS)
      : 0;
    const bucket = ageBucket(daysOverdue);
    buckets[bucket] += balance;

    const c = byCustomer.get(inv.customer.id) ?? {
      customerId: inv.customer.id,
      customerName: inv.customer.name,
      balance: 0,
    };
    c.balance += balance;
    byCustomer.set(inv.customer.id, c);

    rows.push({
      id: inv.id,
      number: inv.number,
      customerId: inv.customer.id,
      customerName: inv.customer.name,
      issuedAt: inv.issuedAt,
      dueAt: inv.dueAt,
      total,
      paid,
      balance,
      daysOverdue,
      bucket,
    });
  }

  // Most overdue first, then by balance — the invoices to chase sit at the top.
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);

  const totalOutstanding =
    Math.round(rows.reduce((n, r) => n + r.balance, 0) * 100) / 100;

  return {
    asOf,
    rows,
    totalOutstanding,
    buckets,
    byCustomer: [...byCustomer.values()].sort((a, b) => b.balance - a.balance),
    count: rows.length,
  };
}
