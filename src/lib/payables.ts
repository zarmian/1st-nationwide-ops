/**
 * Accounts payable — what we owe right now. The mirror of receivables.
 *
 * "Outstanding" = supplier bills (SupplierCost) not yet marked paid, aged by
 * their due date (falling back to the bill date when no due date was set).
 * Partner charges (what subcontractor partners have billed us for work they did
 * on our behalf) are surfaced separately as an informational total — they're
 * settled outside this ledger, so they don't have a paid/unpaid flag here.
 */
import { prisma } from "@/lib/db";
import {
  ageBucket,
  BUCKET_ORDER,
  BUCKET_LABEL,
  type AgedBucket,
} from "@/lib/receivables";

export { ageBucket, BUCKET_ORDER, BUCKET_LABEL };
export type { AgedBucket };

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type Payable = {
  id: string;
  supplier: string;
  category: string;
  reference: string | null;
  billDate: Date;
  dueDate: Date;
  gross: number;
  daysOverdue: number;
  bucket: AgedBucket;
};

export type PartnerOwing = {
  partnerId: string;
  partnerName: string;
  amount: number;
};

export type PayablesSummary = {
  asOf: Date;
  rows: Payable[];
  totalOutstanding: number;
  buckets: Record<AgedBucket, number>;
  bySupplier: { supplier: string; amount: number }[];
  count: number;
  partnerOwings: PartnerOwing[];
  partnerOwingsTotal: number;
};

export async function loadPayables(
  asOf: Date = new Date(),
): Promise<PayablesSummary> {
  const [bills, jobOw, shiftOw, visitOw, partners] = await Promise.all([
    prisma.supplierCost.findMany({
      where: { paidOn: null },
      orderBy: { dueOn: "asc" },
    }),
    prisma.job.groupBy({
      by: ["handledByPartnerId"],
      where: {
        handledByPartnerId: { not: null },
        partnerChargeToUsAmount: { not: null },
        status: { not: "CANCELLED" },
      },
      _sum: { partnerChargeToUsAmount: true },
    }),
    prisma.shift.groupBy({
      by: ["handledByPartnerId"],
      where: {
        handledByPartnerId: { not: null },
        partnerChargeToUsAmount: { not: null },
      },
      _sum: { partnerChargeToUsAmount: true },
    }),
    prisma.patrolVisit.groupBy({
      by: ["handledByPartnerId"],
      where: {
        handledByPartnerId: { not: null },
        partnerChargeToUsAmount: { not: null },
      },
      _sum: { partnerChargeToUsAmount: true },
    }),
    prisma.partner.findMany({ select: { id: true, name: true } }),
  ]);

  const buckets: Record<AgedBucket, number> = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  };
  const bySupplier = new Map<string, number>();
  const rows: Payable[] = [];

  for (const b of bills) {
    const gross = Number(b.gross);
    if (gross <= 0.009) continue;
    const dueDate = b.dueOn ?? b.date;
    const daysOverdue = Math.floor((asOf.getTime() - dueDate.getTime()) / DAY_MS);
    const bucket = ageBucket(daysOverdue);
    buckets[bucket] += gross;
    bySupplier.set(b.supplier, (bySupplier.get(b.supplier) ?? 0) + gross);
    rows.push({
      id: b.id,
      supplier: b.supplier,
      category: b.category,
      reference: b.reference,
      billDate: b.date,
      dueDate,
      gross,
      daysOverdue,
      bucket,
    });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.gross - a.gross);

  // Partner owings — sum partnerChargeToUsAmount per partner across the three
  // activity kinds they can handle for us.
  const partnerName = new Map(partners.map((p) => [p.id, p.name]));
  const owingByPartner = new Map<string, number>();
  const addOwing = (id: string | null, amt: unknown) => {
    if (!id) return;
    owingByPartner.set(id, (owingByPartner.get(id) ?? 0) + Number(amt ?? 0));
  };
  for (const j of jobOw) addOwing(j.handledByPartnerId, j._sum.partnerChargeToUsAmount);
  for (const s of shiftOw) addOwing(s.handledByPartnerId, s._sum.partnerChargeToUsAmount);
  for (const v of visitOw) addOwing(v.handledByPartnerId, v._sum.partnerChargeToUsAmount);
  const partnerOwings: PartnerOwing[] = [...owingByPartner.entries()]
    .map(([partnerId, amount]) => ({
      partnerId,
      partnerName: partnerName.get(partnerId) ?? "Unknown partner",
      amount: round2(amount),
    }))
    .filter((p) => p.amount > 0.009)
    .sort((a, b) => b.amount - a.amount);

  return {
    asOf,
    rows,
    totalOutstanding:
      Math.round(rows.reduce((n, r) => n + r.gross, 0) * 100) / 100,
    buckets,
    bySupplier: [...bySupplier.entries()]
      .map(([supplier, amount]) => ({ supplier, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    count: rows.length,
    partnerOwings,
    partnerOwingsTotal: round2(
      partnerOwings.reduce((n, p) => n + p.amount, 0),
    ),
  };
}
