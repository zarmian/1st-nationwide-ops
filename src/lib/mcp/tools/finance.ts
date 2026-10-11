/**
 * Admin-only money tools for the Claude connector: the management P&L
 * (loadPnl — same basis as /finance/pnl), money owed (loadReceivables — same
 * as /finance/receivables) and the invoice list. Finance always applies the
 * hidden-accounts declutter, as the finance pages do.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadPnl } from "@/lib/pnl";
import { BUCKET_LABEL, BUCKET_ORDER, loadReceivables } from "@/lib/receivables";
import { customerHiddenAnd, loadHiddenScope } from "@/lib/hiddenAccounts";
import {
  matchCustomers,
  money,
  resolveDayRange,
  ukDate,
  ukToday,
  type ToolContext,
} from "./common";

export async function getFinanceSummary(
  ctx: ToolContext,
  input: { from?: string; to?: string },
) {
  const today = ukToday(ctx.now);
  const range = resolveDayRange(input, { from: `${today.slice(0, 8)}01`, to: today }, 400);
  const hidden = await loadHiddenScope(true);
  const [pnl, receivables] = await Promise.all([
    loadPnl(range.fromDate, range.toDate, hidden),
    loadReceivables(ctx.now, hidden),
  ]);

  const overdue = BUCKET_ORDER.filter((b) => b !== "current").reduce(
    (sum, b) => sum + receivables.buckets[b],
    0,
  );

  return {
    period: { from: range.from, to: range.to },
    comparedWith: { from: ukDate(pnl.prevFrom), to: ukDate(pnl.prevTo) },
    basis:
      "Management P&L, ex VAT, by the date work was scheduled for. Revenue = billed activity; gross profit = revenue − officer pay − subcontractor charges; net = gross − overheads (supplier costs).",
    current: pnl.current,
    previous: pnl.previous,
    revenueByService: pnl.revenueByService,
    moneyOwedToUs: {
      asOf: today,
      totalOutstanding: money(receivables.totalOutstanding),
      overdue: money(overdue),
      invoices: receivables.count,
      ageing: Object.fromEntries(
        BUCKET_ORDER.map((b) => [BUCKET_LABEL[b], money(receivables.buckets[b])]),
      ),
      byCustomer: receivables.byCustomer.slice(0, 10).map((c) => ({
        customer: c.customerName,
        balance: money(c.balance),
      })),
    },
  };
}

export async function listInvoices(
  ctx: ToolContext,
  input: {
    status?: "outstanding" | "overdue" | "draft" | "sent" | "paid" | "void" | "all";
    customer?: string;
    limit: number;
  },
) {
  const status = input.status ?? "outstanding";
  const customers = input.customer ? await matchCustomers(input.customer) : null;
  const hidden = await loadHiddenScope(true);

  if (status === "outstanding" || status === "overdue") {
    const r = await loadReceivables(ctx.now, hidden);
    const rows = r.rows.filter(
      (row) =>
        (!customers || customers.ids.includes(row.customerId)) &&
        (status === "outstanding" || row.daysOverdue > 0),
    );
    return {
      status,
      matchedCustomers: customers?.names,
      count: rows.length,
      totalBalance: money(rows.reduce((s, row) => s + row.balance, 0)),
      shown: Math.min(rows.length, input.limit),
      invoices: rows.slice(0, input.limit).map((row) => ({
        number: row.number,
        customer: row.customerName,
        issued: ukDate(row.issuedAt),
        due: ukDate(row.dueAt),
        total: money(row.total),
        paid: money(row.paid),
        balance: money(row.balance),
        daysOverdue: Math.max(0, row.daysOverdue),
        ageing: BUCKET_LABEL[row.bucket],
        lastReminded: ukDate(row.lastRemindedAt),
      })),
    };
  }

  const where: Prisma.InvoiceWhereInput = {
    AND: [
      ...customerHiddenAnd(hidden),
      ...(customers ? [{ customerId: { in: customers.ids } }] : []),
      ...(status !== "all" ? [{ status: status.toUpperCase() as "DRAFT" | "SENT" | "PAID" | "VOID" }] : []),
    ],
  };
  const [count, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        number: true,
        status: true,
        periodFrom: true,
        periodTo: true,
        issuedAt: true,
        dueAt: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        customer: { select: { name: true } },
      },
    }),
  ]);
  return {
    status,
    matchedCustomers: customers?.names,
    count,
    shown: invoices.length,
    invoices: invoices.map((i) => ({
      number: i.number,
      customer: i.customer.name,
      status: i.status,
      period: { from: ukDate(i.periodFrom), to: ukDate(i.periodTo) },
      issued: ukDate(i.issuedAt),
      due: ukDate(i.dueAt),
      net: money(i.subtotal),
      vat: money(i.vatAmount),
      total: money(i.total),
    })),
  };
}
