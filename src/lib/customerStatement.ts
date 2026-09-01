/**
 * Customer account statement — every invoice, payment and credit note for a
 * customer over a period, with a running balance (what they owe us). Emailable
 * and downloadable as a PDF, for chasing and month-end clarity.
 *
 * Balance convention: a positive balance means the customer owes us. Invoices
 * add to it; payments and credit notes reduce it. Only issued invoices
 * (SENT / PAID) and issued credit notes count.
 *
 * The opening balance rolls up everything dated before the window, so the
 * statement always reconciles: opening + period movements = closing.
 */
import { prisma } from "@/lib/db";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { COMPANY } from "@/lib/company";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type StatementTxnType = "INVOICE" | "PAYMENT" | "CREDIT_NOTE";

export type StatementTxn = {
  date: Date;
  type: StatementTxnType;
  ref: string;
  description: string;
  /** Signed: invoice +total, payment −amount, credit note −total. */
  amount: number;
};

export type StatementLine = StatementTxn & { balance: number };

export type CustomerStatement = {
  customer: {
    id: string;
    name: string;
    contactName: string | null;
    contactEmail: string | null;
    billingAddress: string | null;
  };
  from: Date;
  to: Date;
  currency: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  totalCredited: number;
};

/**
 * Pure: fold a running balance over date-sorted transactions from an opening
 * balance. Ties (same date) keep input order — callers pre-sort with invoices
 * before payments so a same-day pay-on-issue reads naturally.
 */
export function runningBalance(
  opening: number,
  txns: StatementTxn[],
): StatementLine[] {
  let bal = opening;
  return txns.map((t) => {
    bal = round2(bal + t.amount);
    return { ...t, balance: bal };
  });
}

export async function loadCustomerStatement(
  customerId: string,
  from: Date,
  to: Date,
): Promise<CustomerStatement | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      contactName: true,
      contactEmail: true,
      billingAddress: true,
    },
  });
  if (!customer) return null;

  const [invoices, payments, creditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerId,
        status: { in: ["SENT", "PAID"] },
        issuedAt: { not: null, lte: to },
      },
      select: { number: true, issuedAt: true, total: true },
    }),
    prisma.invoicePayment.findMany({
      where: { invoice: { customerId }, paidOn: { lte: to } },
      select: {
        amount: true,
        paidOn: true,
        invoice: { select: { number: true } },
      },
    }),
    prisma.creditNote.findMany({
      where: { customerId, status: "ISSUED", issuedAt: { lte: to } },
      select: { number: true, issuedAt: true, total: true },
    }),
  ]);

  // Everything as signed transactions.
  const all: StatementTxn[] = [];
  for (const inv of invoices) {
    all.push({
      date: inv.issuedAt as Date,
      type: "INVOICE",
      ref: inv.number,
      description: `Invoice ${inv.number}`,
      amount: Number(inv.total),
    });
  }
  for (const p of payments) {
    all.push({
      date: p.paidOn,
      type: "PAYMENT",
      ref: p.invoice.number,
      description: `Payment · ${p.invoice.number}`,
      amount: -Number(p.amount),
    });
  }
  for (const cn of creditNotes) {
    all.push({
      date: cn.issuedAt,
      type: "CREDIT_NOTE",
      ref: cn.number,
      description: `Credit note ${cn.number}`,
      amount: -Number(cn.total),
    });
  }

  // Opening balance = everything strictly before the window.
  const opening = round2(
    all
      .filter((t) => t.date < from)
      .reduce((n, t) => n + t.amount, 0),
  );

  // In-window transactions, sorted by date then type (invoice → credit → pay
  // on the same day reads most naturally).
  const typeOrder: Record<StatementTxnType, number> = {
    INVOICE: 0,
    CREDIT_NOTE: 1,
    PAYMENT: 2,
  };
  const inWindow = all
    .filter((t) => t.date >= from && t.date <= to)
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        typeOrder[a.type] - typeOrder[b.type],
    );

  const lines = runningBalance(opening, inWindow);
  const closingBalance = lines.length ? lines[lines.length - 1].balance : opening;

  const totalInvoiced = round2(
    inWindow.filter((t) => t.type === "INVOICE").reduce((n, t) => n + t.amount, 0),
  );
  const totalPaid = round2(
    -inWindow.filter((t) => t.type === "PAYMENT").reduce((n, t) => n + t.amount, 0),
  );
  const totalCredited = round2(
    -inWindow
      .filter((t) => t.type === "CREDIT_NOTE")
      .reduce((n, t) => n + t.amount, 0),
  );

  return {
    customer,
    from,
    to,
    currency: "GBP",
    openingBalance: opening,
    lines,
    closingBalance,
    totalInvoiced,
    totalPaid,
    totalCredited,
  };
}

// ── Emailing ────────────────────────────────────────────────────────────────

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}
function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Email the statement PDF to the customer's contact email. No-op with a clear
 * message when email isn't configured or there's no contact email on file.
 */
export async function sendCustomerStatementEmail(
  customerId: string,
  from: Date,
  to: Date,
): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email isn't set up yet. Add RESEND_API_KEY to send statements.",
    };
  }
  const data = await loadCustomerStatement(customerId, from, to);
  if (!data) return { ok: false, error: "Customer not found." };
  const recipient = data.customer.contactEmail?.trim();
  if (!recipient) {
    return {
      ok: false,
      error: "No contact email on this customer. Add one on their record first.",
    };
  }
  const { renderCustomerStatementPdf } = await import(
    "@/lib/reports/CustomerStatementPdf"
  );
  const pdf = await renderCustomerStatementPdf(data);

  const period = `${longDate(data.from)} – ${longDate(data.to)}`;
  const balance = money(data.closingBalance, data.currency);
  const greeting = data.customer.contactName
    ? `Hi ${data.customer.contactName},`
    : "Hello,";
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#0F1929;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0F1929;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;">${COMPANY.name}</td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 14px;">${greeting}</p>
        <p style="margin:0 0 14px;">Please find your account statement for <strong>${period}</strong> attached.</p>
        <p style="margin:0 0 6px;font-size:14px;color:#475569;">Balance due</p>
        <p style="margin:0 0 16px;font-size:26px;font-weight:bold;">${balance}</p>
        <p style="margin:0 0 4px;">Thank you,</p>
        <p style="margin:0;">${COMPANY.name}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8;">The statement is attached as a PDF. Reply to this email with any questions.</td></tr>
    </table>
  </body>
</html>`;
  const text = [
    greeting,
    "",
    `Please find your account statement for ${period} attached.`,
    "",
    `Balance due: ${balance}`,
    "",
    "Thank you,",
    COMPANY.name,
  ].join("\n");

  const sent = await sendEmail({
    to: recipient,
    subject: `Statement of account · ${period}`,
    html,
    text,
    replyTo: COMPANY.email || undefined,
    attachments: [
      {
        filename: `Statement-${data.customer.name.replace(/[^a-z0-9]+/gi, "-")}.pdf`,
        content: pdf,
      },
    ],
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true };
}
