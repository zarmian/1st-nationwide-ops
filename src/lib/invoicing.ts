/**
 * Customer invoicing. A draft invoice is generated from the completed, billed,
 * not-yet-invoiced activities for a customer in a period; those activities are
 * stamped with `invoiceId` so they can't be invoiced twice. Voiding an invoice
 * unlinks them again.
 *
 * Amounts read the frozen `billedAmount` snapshots — invoicing never re-prices.
 * Lines are grouped by service (one line per service: quantity + total). VAT is
 * a single rate per invoice (UK standard 20% default).
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";
import { COMPANY } from "@/lib/company";
import { dueRecurringLines } from "@/lib/recurring";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import type { InvoicePdfData } from "@/lib/reports/invoiceReport";

const round2 = (n: number) => Math.round(n * 100) / 100;
const humanize = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export type PreviewLine = {
  service: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
};

export type InvoicePreview = {
  customerId: string;
  customerName: string;
  from: Date;
  to: Date;
  lines: PreviewLine[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  activityCount: number;
  recurringCount: number;
  jobIds: string[];
  visitIds: string[];
  shiftIds: string[];
};

const toPreviewLines = (
  rec: { service: string | null; description: string; amount: number }[],
): PreviewLine[] =>
  rec.map((l) => ({
    service: l.service ?? "Recurring",
    description: l.description,
    quantity: 1,
    unitAmount: l.amount,
    amount: l.amount,
  }));

type Client = Prisma.TransactionClient | typeof prisma;

/** Gather the billable, not-yet-invoiced activity for a customer in a window. */
async function gather(db: Client, customerId: string, from: Date, to: Date) {
  const [jobs, visits, shifts] = await Promise.all([
    db.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        completedAt: { not: null },
        billedAmount: { not: null },
        invoiceId: null,
        // Both the customer match and the scheduled-date window are ORs, so
        // combine them under AND rather than clobbering one.
        AND: [
          { OR: [{ customerId }, { site: { is: { customerId } } }] },
          jobScheduledRange(from, to),
        ],
      },
      select: { id: true, type: true, typeLabel: true, billedAmount: true },
    }),
    db.patrolVisit.findMany({
      where: {
        status: "COMPLETED",
        billedAmount: { not: null },
        invoiceId: null,
        site: { is: { customerId } },
        ...visitScheduledRange(from, to),
      },
      select: {
        id: true,
        billedAmount: true,
        patrolSchedule: { select: { kind: true } },
      },
    }),
    db.shift.findMany({
      where: {
        status: "COMPLETED",
        billedAmount: { not: null },
        invoiceId: null,
        site: { is: { customerId } },
        ...shiftScheduledRange(from, to),
      },
      select: { id: true, type: true, billedAmount: true },
    }),
  ]);
  return { jobs, visits, shifts };
}

function buildLines(gathered: Awaited<ReturnType<typeof gather>>): {
  lines: PreviewLine[];
  jobIds: string[];
  visitIds: string[];
  shiftIds: string[];
} {
  const groups = new Map<string, { count: number; sum: number }>();
  const add = (label: string, amount: number) => {
    const g = groups.get(label) ?? { count: 0, sum: 0 };
    g.count += 1;
    g.sum += amount;
    groups.set(label, g);
  };

  const jobIds: string[] = [];
  const visitIds: string[] = [];
  const shiftIds: string[] = [];

  for (const j of gathered.jobs) {
    jobIds.push(j.id);
    add(j.typeLabel ?? humanize(j.type), Number(j.billedAmount ?? 0));
  }
  for (const v of gathered.visits) {
    visitIds.push(v.id);
    add(
      v.patrolSchedule?.kind === "VPI" ? "Void property inspection" : "Mobile patrol",
      Number(v.billedAmount ?? 0),
    );
  }
  for (const s of gathered.shifts) {
    shiftIds.push(s.id);
    add(humanize(s.type), Number(s.billedAmount ?? 0));
  }

  const lines: PreviewLine[] = [...groups.entries()]
    .map(([service, g]) => ({
      service,
      description: service,
      quantity: g.count,
      unitAmount: round2(g.sum / g.count),
      amount: round2(g.sum),
    }))
    .sort((a, b) => b.amount - a.amount);

  return { lines, jobIds, visitIds, shiftIds };
}

function totals(lines: PreviewLine[], vatRate: number) {
  const subtotal = round2(lines.reduce((n, l) => n + l.amount, 0));
  const vatAmount = round2(subtotal * vatRate);
  const total = round2(subtotal + vatAmount);
  return { subtotal, vatAmount, total };
}

export async function previewInvoice(
  customerId: string,
  from: Date,
  to: Date,
  vatRate = COMPANY.vatRate,
): Promise<InvoicePreview | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true },
  });
  if (!customer) return null;

  const built = buildLines(await gather(prisma, customerId, from, to));
  const rec = await dueRecurringLines(prisma, customerId, from, to);
  const recLines = toPreviewLines(rec.lines);
  const lines = [...built.lines, ...recLines];
  const { subtotal, vatAmount, total } = totals(lines, vatRate);

  return {
    customerId,
    customerName: customer.name,
    from,
    to,
    lines,
    subtotal,
    vatRate,
    vatAmount,
    total,
    activityCount:
      built.jobIds.length + built.visitIds.length + built.shiftIds.length,
    recurringCount: recLines.length,
    jobIds: built.jobIds,
    visitIds: built.visitIds,
    shiftIds: built.shiftIds,
  };
}

export type CreateInvoiceResult =
  | { ok: true; invoiceId: string; number: string }
  | { ok: false; error: string };

export async function createInvoice(
  args: {
    customerId: string;
    from: Date;
    to: Date;
    vatRate?: number;
    notes?: string | null;
  },
  userId?: string,
): Promise<CreateInvoiceResult> {
  const vatRate = args.vatRate ?? COMPANY.vatRate;
  try {
    return await prisma.$transaction(async (tx) => {
      const built = buildLines(
        await gather(tx, args.customerId, args.from, args.to),
      );
      const rec = await dueRecurringLines(
        tx,
        args.customerId,
        args.from,
        args.to,
      );
      const { jobIds, visitIds, shiftIds } = built;
      const lines = [...built.lines, ...toPreviewLines(rec.lines)];
      if (lines.length === 0) {
        return {
          ok: false as const,
          error:
            "No billed activity or recurring charges for this customer in that period.",
        };
      }
      const { subtotal, vatAmount, total } = totals(lines, vatRate);

      const seq = await tx.invoice.count();
      const number = `INV-${String(seq + 1).padStart(5, "0")}`;

      const invoice = await tx.invoice.create({
        data: {
          number,
          customerId: args.customerId,
          status: "DRAFT",
          periodFrom: args.from,
          periodTo: args.to,
          subtotal,
          vatRate,
          vatAmount,
          total,
          currency: "GBP",
          notes: args.notes ?? null,
          createdByUserId: userId ?? null,
          lines: {
            create: lines.map((l, i) => ({
              description: l.description,
              service: l.service,
              quantity: l.quantity,
              unitAmount: l.unitAmount,
              amount: l.amount,
              sortOrder: i,
            })),
          },
        },
        select: { id: true, number: true },
      });

      if (jobIds.length)
        await tx.job.updateMany({
          where: { id: { in: jobIds }, invoiceId: null },
          data: { invoiceId: invoice.id },
        });
      if (visitIds.length)
        await tx.patrolVisit.updateMany({
          where: { id: { in: visitIds }, invoiceId: null },
          data: { invoiceId: invoice.id },
        });
      if (shiftIds.length)
        await tx.shift.updateMany({
          where: { id: { in: shiftIds }, invoiceId: null },
          data: { invoiceId: invoice.id },
        });

      // Materialise the recurring-charge occurrences onto this invoice. The
      // (chargeId, periodKey) unique constraint prevents a period being billed
      // twice — a collision aborts the transaction.
      for (const r of rec.runs) {
        await tx.recurringChargeRun.create({
          data: {
            recurringChargeId: r.chargeId,
            periodKey: r.periodKey,
            amount: r.amount,
            invoiceId: invoice.id,
          },
        });
      }

      return { ok: true as const, invoiceId: invoice.id, number: invoice.number };
    });
  } catch (e) {
    console.error("createInvoice failed", e);
    return { ok: false, error: "Couldn't create the invoice. Please retry." };
  }
}

export type InvoiceStatusValue = "DRAFT" | "SENT" | "PAID" | "VOID";

/**
 * Move an invoice through its lifecycle. SENT stamps issue + due dates; VOID
 * unlinks its activities so they can be re-invoiced.
 */
export async function setInvoiceStatus(
  id: string,
  status: InvoiceStatusValue,
): Promise<{ ok: boolean; error?: string }> {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true, dueAt: true, issuedAt: true },
  });
  if (!inv) return { ok: false, error: "Invoice not found." };

  if (status === "VOID") {
    await prisma.$transaction([
      prisma.job.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } }),
      prisma.patrolVisit.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } }),
      prisma.shift.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } }),
      // Free the recurring occurrences so their periods can be billed again.
      prisma.recurringChargeRun.deleteMany({ where: { invoiceId: id } }),
      prisma.invoice.update({ where: { id }, data: { status: "VOID" } }),
    ]);
    return { ok: true };
  }

  const data: Prisma.InvoiceUpdateInput = { status };
  if (status === "SENT" && !inv.issuedAt) {
    const now = new Date();
    data.issuedAt = now;
    data.dueAt = new Date(now.getTime() + COMPANY.paymentTermsDays * 86_400_000);
  }
  await prisma.invoice.update({ where: { id }, data });
  return { ok: true };
}

// ── Payments ──────────────────────────────────────────────────────────────

export type RecordPaymentInput = {
  amount: number;
  paidOn: Date;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
};

/**
 * Record a payment (or part payment) against an invoice. Once the payments
 * cover the invoice total it auto-flips to PAID. Voided invoices are rejected.
 */
export async function recordPayment(
  invoiceId: string,
  input: RecordPaymentInput,
  userId?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(input.amount > 0)) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, total: true },
  });
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "VOID") {
    return { ok: false, error: "This invoice is voided — un-void it first." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoicePayment.create({
        data: {
          invoiceId,
          amount: input.amount,
          paidOn: input.paidOn,
          method: input.method ?? null,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          createdByUserId: userId ?? null,
        },
      });
      const agg = await tx.invoicePayment.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      });
      const paid = Number(agg._sum.amount ?? 0);
      // Cover the total (allow a penny of rounding slack) → settle it.
      if (paid + 0.009 >= Number(inv.total) && inv.status !== "PAID") {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: "PAID" },
        });
      }
    });
    return { ok: true };
  } catch (e) {
    console.error("recordPayment failed", e);
    return { ok: false, error: "Couldn't record the payment. Please retry." };
  }
}

/**
 * Delete a payment (correcting a mistake). If removing it drops a PAID invoice
 * back below its total, the invoice reverts to SENT so it's chased again.
 */
export async function deletePayment(
  paymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const pay = await prisma.invoicePayment.findUnique({
    where: { id: paymentId },
    select: { invoiceId: true },
  });
  if (!pay) return { ok: false, error: "Payment not found." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoicePayment.delete({ where: { id: paymentId } });
      const inv = await tx.invoice.findUnique({
        where: { id: pay.invoiceId },
        select: { status: true, total: true },
      });
      if (inv?.status === "PAID") {
        const agg = await tx.invoicePayment.aggregate({
          where: { invoiceId: pay.invoiceId },
          _sum: { amount: true },
        });
        if (Number(agg._sum.amount ?? 0) + 0.009 < Number(inv.total)) {
          await tx.invoice.update({
            where: { id: pay.invoiceId },
            data: { status: "SENT" },
          });
        }
      }
    });
    return { ok: true };
  } catch (e) {
    console.error("deletePayment failed", e);
    return { ok: false, error: "Couldn't delete the payment. Please retry." };
  }
}

// ── Sending ───────────────────────────────────────────────────────────────

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}

function longDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function invoiceEmailBodies(data: InvoicePdfData): { html: string; text: string } {
  const total = money(data.total, data.currency);
  const greeting = data.customer.contactName
    ? `Hi ${data.customer.contactName},`
    : "Hello,";
  const dueLine = data.dueAt
    ? `Payment is due by <strong>${longDate(data.dueAt)}</strong>.`
    : "";
  const dueText = data.dueAt ? `Payment is due by ${longDate(data.dueAt)}.` : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#0F1929;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0F1929;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;">${COMPANY.name}</td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 14px;">${greeting}</p>
        <p style="margin:0 0 14px;">Please find attached invoice <strong>${data.number}</strong> for the period ${longDate(data.periodFrom)} – ${longDate(data.periodTo)}.</p>
        <p style="margin:0 0 6px;font-size:14px;color:#475569;">Amount due</p>
        <p style="margin:0 0 16px;font-size:26px;font-weight:bold;">${total}</p>
        ${dueLine ? `<p style="margin:0 0 14px;">${dueLine}</p>` : ""}
        <p style="margin:0 0 4px;">Thank you,</p>
        <p style="margin:0;">${COMPANY.name}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8;">The invoice is attached as a PDF. Reply to this email with any questions.</td></tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting,
    "",
    `Please find attached invoice ${data.number} for the period ${longDate(data.periodFrom)} – ${longDate(data.periodTo)}.`,
    "",
    `Amount due: ${total}`,
    dueText,
    "",
    "Thank you,",
    COMPANY.name,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return { html, text };
}

/**
 * Email the invoice PDF to the customer's contact email. Stamps `emailedAt`,
 * and on the first send from a DRAFT it also issues the invoice (status → SENT,
 * issue + due dates set) so the ageing / receivables clock starts.
 *
 * No-op with a clear message when email isn't configured or there's no contact
 * email on file — never throws into the request.
 */
export async function sendInvoiceEmail(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email isn't set up yet. Add RESEND_API_KEY to send invoices.",
    };
  }
  // Loaded lazily so the (heavy) @react-pdf renderer stays out of the module
  // graph of every page that touches invoicing.
  const { loadInvoiceForPdf } = await import("@/lib/reports/invoiceReport");
  const data = await loadInvoiceForPdf(id);
  if (!data) return { ok: false, error: "Invoice not found." };
  if (data.status === "VOID") {
    return { ok: false, error: "This invoice is voided — un-void it first." };
  }
  const to = data.customer.contactEmail?.trim();
  if (!to) {
    return {
      ok: false,
      error:
        "No contact email on file for this customer. Add one on the customer record first.",
    };
  }

  const { renderInvoicePdf } = await import("@/lib/reports/InvoicePdf");
  const pdf = await renderInvoicePdf(data);
  const { html, text } = invoiceEmailBodies(data);

  const sent = await sendEmail({
    to,
    subject: `Invoice ${data.number} from ${COMPANY.name}`,
    html,
    text,
    replyTo: COMPANY.email || undefined,
    attachments: [{ filename: `${data.number}.pdf`, content: pdf }],
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  const now = new Date();
  const update: Prisma.InvoiceUpdateInput = { emailedAt: now };
  if (data.status === "DRAFT") update.status = "SENT";
  if (!data.issuedAt) {
    update.issuedAt = now;
    update.dueAt = new Date(now.getTime() + COMPANY.paymentTermsDays * 86_400_000);
  }
  await prisma.invoice.update({ where: { id }, data: update });
  return { ok: true };
}
