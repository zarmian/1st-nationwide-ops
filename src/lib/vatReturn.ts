/**
 * VAT return summary — the **output** VAT we've charged customers in a period,
 * ready to transcribe onto an HMRC VAT return.
 *
 * Basis: tax point = invoice **issue date**. Only issued invoices (status SENT
 * or PAID) count; DRAFT (not yet issued) and VOID (cancelled) are excluded. This
 * is the standard accrual basis — VAT is due when the invoice is raised, not
 * when it's paid.
 *
 * Scope: sales only. The platform bills customers but doesn't track supplier
 * invoices, so **input** VAT (Box 4 — VAT reclaimed on purchases) isn't
 * available here; the page says so. What this produces maps to:
 *   Box 1 — VAT due on sales      = Σ vatAmount
 *   Box 6 — total sales ex VAT    = Σ subtotal
 */
import { prisma } from "@/lib/db";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type Quarter = { label: string; from: Date; to: Date };

const Q_START = ["Jan", "Apr", "Jul", "Oct"];
const Q_END = ["Mar", "Jun", "Sep", "Dec"];

/** The standard calendar quarter (q = 1–4) of a given year. */
export function calendarQuarter(year: number, q: number): Quarter {
  const startMonth = (q - 1) * 3;
  const from = new Date(year, startMonth, 1);
  // Day 0 of the month after the quarter = last day of the quarter.
  const to = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { label: `${Q_START[q - 1]}–${Q_END[q - 1]} ${year}`, from, to };
}

function quarterOf(date: Date): { year: number; q: number } {
  return { year: date.getFullYear(), q: Math.floor(date.getMonth() / 3) + 1 };
}

/** The current calendar quarter and the `count - 1` before it, newest first. */
export function recentQuarters(now: Date, count = 5): Quarter[] {
  let { year, q } = quarterOf(now);
  const out: Quarter[] = [];
  for (let i = 0; i < count; i++) {
    out.push(calendarQuarter(year, q));
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

/** The calendar quarter that `now` falls in. */
export function currentQuarter(now: Date = new Date()): Quarter {
  const { year, q } = quarterOf(now);
  return calendarQuarter(year, q);
}

export type VatRateBreakdown = {
  rate: number;
  net: number;
  vat: number;
  count: number;
};

export type VatReturnInvoice = {
  id: string;
  number: string;
  customerName: string;
  issuedAt: Date;
  net: number;
  vat: number;
  gross: number;
  status: string;
};

export type VatReturnSummary = {
  from: Date;
  to: Date;
  /** Box 1 — VAT due on sales (output tax). */
  vatDueOnSales: number;
  /** Box 6 — total value of sales excluding VAT. */
  netSales: number;
  /** Box 1 + Box 6 — gross billed. Not an HMRC box; a sanity total. */
  gross: number;
  count: number;
  byRate: VatRateBreakdown[];
  invoices: VatReturnInvoice[];
};

export async function loadVatReturn(
  from: Date,
  to: Date,
): Promise<VatReturnSummary> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "PAID"] },
      issuedAt: { gte: from, lte: to },
    },
    include: { customer: { select: { name: true } } },
    orderBy: { issuedAt: "asc" },
  });

  let vatDueOnSales = 0;
  let netSales = 0;
  let gross = 0;
  const rateMap = new Map<number, VatRateBreakdown>();
  const rows: VatReturnInvoice[] = [];

  for (const inv of invoices) {
    const net = Number(inv.subtotal);
    const vat = Number(inv.vatAmount);
    const total = Number(inv.total);
    netSales += net;
    vatDueOnSales += vat;
    gross += total;

    const rate = Number(inv.vatRate);
    const rb = rateMap.get(rate) ?? { rate, net: 0, vat: 0, count: 0 };
    rb.net += net;
    rb.vat += vat;
    rb.count += 1;
    rateMap.set(rate, rb);

    rows.push({
      id: inv.id,
      number: inv.number,
      customerName: inv.customer.name,
      // Non-null: the query filters issuedAt to a range.
      issuedAt: inv.issuedAt as Date,
      net,
      vat,
      gross: total,
      status: inv.status,
    });
  }

  return {
    from,
    to,
    vatDueOnSales: round2(vatDueOnSales),
    netSales: round2(netSales),
    gross: round2(gross),
    count: rows.length,
    byRate: [...rateMap.values()]
      .map((r) => ({
        rate: r.rate,
        net: round2(r.net),
        vat: round2(r.vat),
        count: r.count,
      }))
      .sort((a, b) => b.rate - a.rate),
    invoices: rows,
  };
}
