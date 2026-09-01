import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { VoidCreditNoteButton } from "../_components/VoidCreditNoteButton";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  ISSUED: "chip-green",
  VOID: "chip-red",
};

export default async function CreditNoteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();
  const cn = await prisma.creditNote.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { name: true, billingAddress: true } },
      invoice: { select: { id: true, number: true } },
    },
  });
  if (!cn) notFound();

  return (
    <div className="section">
      <PageHeader
        title={cn.number}
        backHref="/finance/credit-notes"
        backLabel="Credit notes"
        subtitle={
          <>
            {cn.customer.name} · Issued {formatDate(cn.issuedAt)}
            {cn.invoice ? (
              <>
                {" "}
                · against{" "}
                <Link
                  href={`/finance/invoices/${cn.invoice.id}`}
                  className="text-brand-blue-dark hover:underline"
                >
                  {cn.invoice.number}
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <a
            href={`/api/credit-notes/${cn.id}/pdf`}
            className="btn-secondary text-sm"
          >
            Download PDF
          </a>
        }
      />

      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={STATUS_CHIP[cn.status] ?? "chip-slate"}>
            {cn.status}
          </span>
          {cn.status === "ISSUED" && <VoidCreditNoteButton id={cn.id} />}
        </div>

        <div>
          <p className="label">Reason</p>
          <p className="text-sm text-slate-700">{cn.reason}</p>
        </div>

        <div className="flex flex-col items-end gap-1 text-sm border-t border-slate-100 pt-4">
          <div className="flex gap-8">
            <span className="text-slate-500">Subtotal</span>
            <span className="tabular-nums">{formatMoney(Number(cn.subtotal))}</span>
          </div>
          <div className="flex gap-8">
            <span className="text-slate-500">
              VAT ({Math.round(Number(cn.vatRate) * 100)}%)
            </span>
            <span className="tabular-nums">{formatMoney(Number(cn.vatAmount))}</span>
          </div>
          <div className="flex gap-8 text-base font-semibold text-brand-navy">
            <span>Total credited</span>
            <span className="tabular-nums">{formatMoney(Number(cn.total))}</span>
          </div>
        </div>

        {cn.notes ? (
          <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
            {cn.notes}
          </p>
        ) : null}
      </div>
    </div>
  );
}
