import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { InvoiceStatusButtons } from "../_components/InvoiceStatusButtons";
import { InvoiceEmailButton } from "../_components/InvoiceEmailButton";
import { InvoicePayments } from "../_components/InvoicePayments";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "chip-slate",
  SENT: "chip-info",
  PAID: "chip-green",
  VOID: "chip-red",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();
  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: {
        select: { name: true, billingAddress: true, contactEmail: true },
      },
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { paidOn: "desc" } },
      _count: { select: { jobs: true, visits: true, shifts: true } },
    },
  });
  if (!inv) notFound();
  const activityCount = inv._count.jobs + inv._count.visits + inv._count.shifts;
  const contactEmail = inv.customer.contactEmail?.trim() || null;

  return (
    <div className="section">
      <PageHeader
        title={inv.number}
        backHref="/finance/invoices"
        backLabel="Invoices"
        subtitle={
          <>
            {inv.customer.name} · {formatDate(inv.periodFrom)} –{" "}
            {formatDate(inv.periodTo)}
          </>
        }
        actions={
          <>
            <a
              href={`/api/invoices/${inv.id}/pdf`}
              className="btn-secondary text-sm"
            >
              Download PDF
            </a>
            <InvoiceEmailButton
              id={inv.id}
              to={contactEmail}
              emailed={Boolean(inv.emailedAt)}
              voided={inv.status === "VOID"}
            />
          </>
        }
      />

      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={STATUS_CHIP[inv.status] ?? "chip-slate"}>
              {inv.status}
            </span>
            <span className="text-xs text-slate-500">
              Issued {formatDate(inv.issuedAt)} · Due {formatDate(inv.dueAt)}
              {inv.emailedAt ? ` · Emailed ${formatDate(inv.emailedAt)}` : ""}
            </span>
          </div>
          <InvoiceStatusButtons id={inv.id} status={inv.status} />
        </div>

        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Service</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Unit</th>
                <th className="col-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="col-num">{l.quantity}</td>
                  <td className="col-num">{formatMoney(Number(l.unitAmount))}</td>
                  <td className="col-num">{formatMoney(Number(l.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-end gap-1 text-sm">
          <div className="flex gap-8">
            <span className="text-slate-500">Subtotal</span>
            <span className="tabular-nums">
              {formatMoney(Number(inv.subtotal))}
            </span>
          </div>
          <div className="flex gap-8">
            <span className="text-slate-500">
              VAT ({Math.round(Number(inv.vatRate) * 100)}%)
            </span>
            <span className="tabular-nums">
              {formatMoney(Number(inv.vatAmount))}
            </span>
          </div>
          <div className="flex gap-8 text-base font-semibold text-brand-navy">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(Number(inv.total))}</span>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {activityCount} activities on this invoice.
          {inv.notes ? ` · ${inv.notes}` : ""}
        </p>
      </div>

      {!contactEmail && (
        <p className="text-xs text-amber-600">
          No contact email on {inv.customer.name} — add one on the customer
          record to email this invoice.
        </p>
      )}

      <InvoicePayments
        invoiceId={inv.id}
        currency={inv.currency}
        total={Number(inv.total)}
        locked={inv.status === "VOID"}
        payments={inv.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paidOn: p.paidOn.toISOString(),
          method: p.method,
          reference: p.reference,
          notes: p.notes,
        }))}
      />
    </div>
  );
}
