/**
 * Accounting exports — CSVs a bookkeeper can import into Xero / QuickBooks /
 * Sage, or reconcile against the bank.
 *
 *   Sales (invoices)   — one row per issued invoice, by invoice (tax point)
 *                        date. Net / VAT / gross plus paid + balance. Excludes
 *                        drafts (not issued) and voided invoices.
 *   Payments received  — one row per payment, by payment date. For bank rec.
 *
 * Dates are ISO 8601 (YYYY-MM-DD) — unambiguous across locales; the importer
 * can reformat to DD/MM/YYYY if its template needs it. Every cell is quoted and
 * internal quotes doubled, so the output round-trips through spreadsheets.
 *
 * The row shapes are pure (data → string) so they're unit-testable without a
 * DB; the loaders do the querying.
 */
import { prisma } from "@/lib/db";
import { toIsoDate } from "@/lib/dates";

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
function money(n: number): string {
  return n.toFixed(2);
}
function pct(rate: number): string {
  // 0.2 → "20", 0.05 → "5"
  return String(Math.round(rate * 10000) / 100);
}

// ── Sales / invoices ────────────────────────────────────────────────────────

export type InvoiceExportRow = {
  number: string;
  issueDate: Date | null;
  dueDate: Date | null;
  customer: string;
  customerEmail: string | null;
  description: string;
  currency: string;
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
  status: string;
  paid: number;
  balance: number;
};

const INVOICE_COLUMNS = [
  "invoice_number",
  "issue_date",
  "due_date",
  "customer",
  "customer_email",
  "description",
  "currency",
  "net",
  "vat_rate_pct",
  "vat",
  "gross",
  "status",
  "paid",
  "balance",
];

export function invoiceCsvHeader(): string {
  return INVOICE_COLUMNS.map(csvCell).join(",");
}

export function invoiceCsvLine(r: InvoiceExportRow): string {
  return [
    r.number,
    r.issueDate ? toIsoDate(r.issueDate) : "",
    r.dueDate ? toIsoDate(r.dueDate) : "",
    r.customer,
    r.customerEmail ?? "",
    r.description,
    r.currency,
    money(r.net),
    pct(r.vatRate),
    money(r.vat),
    money(r.gross),
    r.status,
    money(r.paid),
    money(r.balance),
  ]
    .map(csvCell)
    .join(",");
}

export async function loadInvoiceExportRows(
  from: Date,
  to: Date,
): Promise<InvoiceExportRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "PAID"] },
      issuedAt: { gte: from, lte: to },
    },
    include: {
      customer: { select: { name: true, contactEmail: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { issuedAt: "asc" },
  });
  return invoices.map((inv) => {
    const net = Number(inv.subtotal);
    const vat = Number(inv.vatAmount);
    const gross = Number(inv.total);
    const paid = inv.payments.reduce((n, p) => n + Number(p.amount), 0);
    return {
      number: inv.number,
      issueDate: inv.issuedAt,
      dueDate: inv.dueAt,
      customer: inv.customer.name,
      customerEmail: inv.customer.contactEmail,
      description: `Security services ${toIsoDate(inv.periodFrom)} to ${toIsoDate(inv.periodTo)}`,
      currency: inv.currency,
      net,
      vatRate: Number(inv.vatRate),
      vat,
      gross,
      status: inv.status,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((gross - paid) * 100) / 100,
    };
  });
}

export async function invoicesCsv(from: Date, to: Date): Promise<string> {
  const rows = await loadInvoiceExportRows(from, to);
  return [invoiceCsvHeader(), ...rows.map(invoiceCsvLine)].join("\n") + "\n";
}

// ── Payments received ───────────────────────────────────────────────────────

export type PaymentExportRow = {
  date: Date;
  invoiceNumber: string;
  customer: string;
  currency: string;
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
};

const PAYMENT_COLUMNS = [
  "date",
  "invoice_number",
  "customer",
  "currency",
  "amount",
  "method",
  "reference",
  "note",
];

export function paymentCsvHeader(): string {
  return PAYMENT_COLUMNS.map(csvCell).join(",");
}

export function paymentCsvLine(r: PaymentExportRow): string {
  return [
    toIsoDate(r.date),
    r.invoiceNumber,
    r.customer,
    r.currency,
    money(r.amount),
    r.method ?? "",
    r.reference ?? "",
    r.note ?? "",
  ]
    .map(csvCell)
    .join(",");
}

export async function loadPaymentExportRows(
  from: Date,
  to: Date,
): Promise<PaymentExportRow[]> {
  const payments = await prisma.invoicePayment.findMany({
    where: { paidOn: { gte: from, lte: to } },
    include: {
      invoice: {
        select: { number: true, currency: true, customer: { select: { name: true } } },
      },
    },
    orderBy: { paidOn: "asc" },
  });
  return payments.map((p) => ({
    date: p.paidOn,
    invoiceNumber: p.invoice.number,
    customer: p.invoice.customer.name,
    currency: p.invoice.currency,
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
    note: p.notes,
  }));
}

export async function paymentsCsv(from: Date, to: Date): Promise<string> {
  const rows = await loadPaymentExportRows(from, to);
  return [paymentCsvHeader(), ...rows.map(paymentCsvLine)].join("\n") + "\n";
}

// ── Supplier costs / purchases ──────────────────────────────────────────────

export type CostExportRow = {
  date: Date;
  supplier: string;
  category: string;
  description: string | null;
  currency: string;
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
  reclaimable: boolean;
  reference: string | null;
};

const COST_COLUMNS = [
  "date",
  "supplier",
  "category",
  "description",
  "currency",
  "net",
  "vat_rate_pct",
  "vat",
  "gross",
  "vat_reclaimable",
  "reference",
];

export function costCsvHeader(): string {
  return COST_COLUMNS.map(csvCell).join(",");
}

export function costCsvLine(r: CostExportRow): string {
  return [
    toIsoDate(r.date),
    r.supplier,
    r.category,
    r.description ?? "",
    r.currency,
    money(r.net),
    pct(r.vatRate),
    money(r.vat),
    money(r.gross),
    r.reclaimable ? "yes" : "no",
    r.reference ?? "",
  ]
    .map(csvCell)
    .join(",");
}

export async function loadCostExportRows(
  from: Date,
  to: Date,
): Promise<CostExportRow[]> {
  const costs = await prisma.supplierCost.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  return costs.map((c) => ({
    date: c.date,
    supplier: c.supplier,
    category: c.category,
    description: c.description,
    currency: "GBP",
    net: Number(c.net),
    vatRate: Number(c.vatRate),
    vat: Number(c.vatAmount),
    gross: Number(c.gross),
    reclaimable: c.reclaimable,
    reference: c.reference,
  }));
}

export async function costsCsv(from: Date, to: Date): Promise<string> {
  const rows = await loadCostExportRows(from, to);
  return [costCsvHeader(), ...rows.map(costCsvLine)].join("\n") + "\n";
}

// ── Counts (for the export page preview) ────────────────────────────────────

export async function accountingCounts(
  from: Date,
  to: Date,
): Promise<{
  invoices: number;
  payments: number;
  costs: number;
  sales: number;
  received: number;
  spent: number;
}> {
  const [invAgg, payAgg, costAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: { in: ["SENT", "PAID"] }, issuedAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.invoicePayment.aggregate({
      where: { paidOn: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.supplierCost.aggregate({
      where: { date: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { gross: true },
    }),
  ]);
  return {
    invoices: invAgg._count._all,
    payments: payAgg._count._all,
    costs: costAgg._count._all,
    sales: Number(invAgg._sum.total ?? 0),
    received: Number(payAgg._sum.amount ?? 0),
    spent: Number(costAgg._sum.gross ?? 0),
  };
}
