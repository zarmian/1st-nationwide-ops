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
