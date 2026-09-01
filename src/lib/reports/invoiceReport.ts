import { prisma } from "@/lib/db";

export type InvoicePdfLine = {
  description: string;
  detail: string | null;
  quantity: number;
  unitAmount: number;
  amount: number;
};

export type InvoicePdfData = {
  number: string;
  status: string;
  periodFrom: Date;
  periodTo: Date;
  issuedAt: Date | null;
  dueAt: Date | null;
  currency: string;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  customer: {
    name: string;
    contactName: string | null;
    billingAddress: string | null;
    contactEmail: string | null;
  };
  lines: InvoicePdfLine[];
};

export async function loadInvoiceForPdf(
  id: string,
): Promise<InvoicePdfData | null> {
  const inv = await prisma.invoice.findUnique({
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
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!inv) return null;
  return {
    number: inv.number,
    status: inv.status,
    periodFrom: inv.periodFrom,
    periodTo: inv.periodTo,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    currency: inv.currency,
    subtotal: Number(inv.subtotal),
    vatRate: Number(inv.vatRate),
    vatAmount: Number(inv.vatAmount),
    total: Number(inv.total),
    notes: inv.notes,
    customer: inv.customer,
    lines: inv.lines.map((l) => ({
      description: l.description,
      detail: l.detail,
      quantity: l.quantity,
      unitAmount: Number(l.unitAmount),
      amount: Number(l.amount),
    })),
  };
}
