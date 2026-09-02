import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  ISSUED: "chip-green",
  VOID: "chip-red",
};

export default async function CreditNotesPage() {
  await requireAdmin();
  const notes = await prisma.creditNote.findMany({
    where: { customer: { hidden: false } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true } },
      invoice: { select: { number: true } },
    },
  });

  return (
    <div className="section">
      <PageHeader
        title="Credit notes"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Reduce what a customer owes — corrections, disputes, goodwill. Nets off receivables and VAT."
        actions={
          <Link href="/finance/credit-notes/new" className="btn-primary text-sm">
            New credit note
          </Link>
        }
      />

      {notes.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No credit notes yet</p>
          <p className="empty-blurb">
            Create one with “New credit note”, or from an invoice's “Credit
            note” button.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Against</th>
                  <th>Issued</th>
                  <th className="col-num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((cn) => (
                  <tr key={cn.id}>
                    <td>
                      <Link
                        href={`/finance/credit-notes/${cn.id}`}
                        className="text-brand-blue-dark hover:underline font-medium"
                      >
                        {cn.number}
                      </Link>
                    </td>
                    <td>{cn.customer.name}</td>
                    <td className="text-slate-600">{cn.invoice?.number ?? "—"}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(cn.issuedAt)}
                    </td>
                    <td className="col-num">{formatMoney(Number(cn.total))}</td>
                    <td>
                      <span className={STATUS_CHIP[cn.status] ?? "chip-slate"}>
                        {cn.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
