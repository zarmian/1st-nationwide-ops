import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "chip-slate",
  SENT: "chip-info",
  PAID: "chip-green",
  VOID: "chip-red",
};

export default async function InvoicesPage() {
  await requireAdmin();
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { customer: { select: { name: true } } },
  });

  return (
    <div className="section">
      <PageHeader
        title="Invoices"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Customer invoices generated from billed activity."
        actions={
          <>
            <Link href="/finance/receivables" className="btn-secondary text-sm">
              Receivables →
            </Link>
            <Link href="/finance/invoices/new" className="btn-primary text-sm">
              New invoice
            </Link>
          </>
        }
      />

      {invoices.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No invoices yet</p>
          <p className="empty-blurb">
            Create one from billed activity with “New invoice”.
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
                  <th>Period</th>
                  <th>Issued</th>
                  <th className="col-num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link
                        href={`/finance/invoices/${inv.id}`}
                        className="text-brand-blue-dark hover:underline font-medium"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td>{inv.customer.name}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(inv.periodFrom)} – {formatDate(inv.periodTo)}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(inv.issuedAt)}
                    </td>
                    <td className="col-num">{formatMoney(Number(inv.total))}</td>
                    <td>
                      <span className={STATUS_CHIP[inv.status] ?? "chip-slate"}>
                        {inv.status}
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
