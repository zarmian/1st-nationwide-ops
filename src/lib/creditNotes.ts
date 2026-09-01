/**
 * Credit notes — reduce what a customer owes (correction, dispute, goodwill,
 * service not delivered). A single net + VAT amount with a reason, optionally
 * linked to the invoice it credits.
 *
 * Effects (read at query time, never re-priced):
 *   - Receivables: an ISSUED credit note linked to an invoice reduces that
 *     invoice's outstanding balance (see lib/receivables.ts).
 *   - VAT return: nets off output VAT (Box 1) and sales (Box 6) by issue date
 *     (see lib/vatReturn.ts).
 * Voiding a credit note reverses both — it stops counting everywhere.
 */
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/company";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CreateCreditNoteResult =
  | { ok: true; id: string; number: string }
  | { ok: false; error: string };

export async function createCreditNote(
  args: {
    customerId: string;
    invoiceId?: string | null;
    net: number;
    vatRate?: number;
    reason: string;
    notes?: string | null;
  },
  userId?: string,
): Promise<CreateCreditNoteResult> {
  const reason = args.reason?.trim();
  if (!reason) return { ok: false, error: "Give a reason for the credit note." };
  if (!Number.isFinite(args.net) || args.net <= 0) {
    return { ok: false, error: "Enter a credit amount greater than zero." };
  }
  const vatRate = args.vatRate ?? COMPANY.vatRate;
  const subtotal = round2(args.net);
  const vatAmount = round2(subtotal * vatRate);
  const total = round2(subtotal + vatAmount);

  try {
    return await prisma.$transaction(async (tx) => {
      // Guard the invoice link belongs to the same customer.
      if (args.invoiceId) {
        const inv = await tx.invoice.findUnique({
          where: { id: args.invoiceId },
          select: { customerId: true },
        });
        if (!inv || inv.customerId !== args.customerId) {
          return {
            ok: false as const,
            error: "That invoice doesn't belong to this customer.",
          };
        }
      }
      const seq = await tx.creditNote.count();
      const number = `CN-${String(seq + 1).padStart(5, "0")}`;
      const cn = await tx.creditNote.create({
        data: {
          number,
          customerId: args.customerId,
          invoiceId: args.invoiceId ?? null,
          reason,
          subtotal,
          vatRate,
          vatAmount,
          total,
          currency: "GBP",
          notes: args.notes?.trim() || null,
          createdByUserId: userId ?? null,
        },
        select: { id: true, number: true },
      });
      return { ok: true as const, id: cn.id, number: cn.number };
    });
  } catch (e) {
    console.error("createCreditNote failed", e);
    return { ok: false, error: "Couldn't create the credit note. Please retry." };
  }
}

export async function voidCreditNote(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.creditNote.update({ where: { id }, data: { status: "VOID" } });
    return { ok: true };
  } catch (e) {
    console.error("voidCreditNote failed", e);
    return { ok: false, error: "Couldn't void the credit note. Please retry." };
  }
}

export type CreditNotePdfData = {
  number: string;
  status: string;
  issuedAt: Date;
  reason: string;
  currency: string;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  invoiceNumber: string | null;
  customer: {
    name: string;
    contactName: string | null;
    billingAddress: string | null;
    contactEmail: string | null;
  };
};

export async function loadCreditNoteForPdf(
  id: string,
): Promise<CreditNotePdfData | null> {
  const cn = await prisma.creditNote.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          name: true,
          contactName: true,
          billingAddress: true,
          contactEmail: true,
        },
      },
      invoice: { select: { number: true } },
    },
  });
  if (!cn) return null;
  return {
    number: cn.number,
    status: cn.status,
    issuedAt: cn.issuedAt,
    reason: cn.reason,
    currency: cn.currency,
    subtotal: Number(cn.subtotal),
    vatRate: Number(cn.vatRate),
    vatAmount: Number(cn.vatAmount),
    total: Number(cn.total),
    notes: cn.notes,
    invoiceNumber: cn.invoice?.number ?? null,
    customer: cn.customer,
  };
}
