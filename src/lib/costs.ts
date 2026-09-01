/**
 * Supplier costs / bills — the purchase side of the ledger. Each row carries
 * input VAT so the VAT return can reclaim it (Box 4) and P&L can show true net
 * profit (billed − officer pay − overheads), not just gross margin.
 *
 * Costs are attributed by their bill (tax-point) `date`, matching how the sales
 * side uses the invoice date.
 */
import { prisma } from "@/lib/db";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Suggested cost categories (free text — the UI offers these). */
export const COST_CATEGORIES = [
  "Subcontractor",
  "Fuel",
  "Vehicle",
  "Uniform & equipment",
  "Insurance",
  "Office & admin",
  "Software",
  "Other",
];

export type CostRow = {
  id: string;
  date: Date;
  supplier: string;
  category: string;
  description: string | null;
  net: number;
  vatRate: number;
  vatAmount: number;
  gross: number;
  reference: string | null;
  reclaimable: boolean;
  dueOn: Date | null;
  paidOn: Date | null;
  notes: string | null;
};

export type CostCategoryTotal = {
  category: string;
  net: number;
  vat: number;
  gross: number;
  count: number;
};

export type CostsSummary = {
  from: Date;
  to: Date;
  rows: CostRow[];
  net: number;
  vat: number;
  gross: number;
  /** Input VAT that can actually be reclaimed (Box 4). */
  reclaimableVat: number;
  byCategory: CostCategoryTotal[];
};

export async function loadCosts(from: Date, to: Date): Promise<CostsSummary> {
  const costs = await prisma.supplierCost.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
  });

  let net = 0;
  let vat = 0;
  let gross = 0;
  let reclaimableVat = 0;
  const cat = new Map<string, CostCategoryTotal>();

  const rows: CostRow[] = costs.map((c) => {
    const n = Number(c.net);
    const v = Number(c.vatAmount);
    const g = Number(c.gross);
    net += n;
    vat += v;
    gross += g;
    if (c.reclaimable) reclaimableVat += v;

    const row = cat.get(c.category) ?? {
      category: c.category,
      net: 0,
      vat: 0,
      gross: 0,
      count: 0,
    };
    row.net += n;
    row.vat += v;
    row.gross += g;
    row.count += 1;
    cat.set(c.category, row);

    return {
      id: c.id,
      date: c.date,
      supplier: c.supplier,
      category: c.category,
      description: c.description,
      net: n,
      vatRate: Number(c.vatRate),
      vatAmount: v,
      gross: g,
      reference: c.reference,
      reclaimable: c.reclaimable,
      dueOn: c.dueOn,
      paidOn: c.paidOn,
      notes: c.notes,
    };
  });

  return {
    from,
    to,
    rows,
    net: round2(net),
    vat: round2(vat),
    gross: round2(gross),
    reclaimableVat: round2(reclaimableVat),
    byCategory: [...cat.values()]
      .map((r) => ({
        category: r.category,
        net: round2(r.net),
        vat: round2(r.vat),
        gross: round2(r.gross),
        count: r.count,
      }))
      .sort((a, b) => b.gross - a.gross),
  };
}

/**
 * Input VAT + net purchases in a window, for the VAT return.
 *   Box 4 = reclaimable input VAT; Box 7 = total net purchases.
 */
export async function loadInputVat(
  from: Date,
  to: Date,
): Promise<{ inputVat: number; netPurchases: number }> {
  const [reclaimable, all] = await Promise.all([
    prisma.supplierCost.aggregate({
      where: { date: { gte: from, lte: to }, reclaimable: true },
      _sum: { vatAmount: true },
    }),
    prisma.supplierCost.aggregate({
      where: { date: { gte: from, lte: to } },
      _sum: { net: true },
    }),
  ]);
  return {
    inputVat: round2(Number(reclaimable._sum.vatAmount ?? 0)),
    netPurchases: round2(Number(all._sum.net ?? 0)),
  };
}
