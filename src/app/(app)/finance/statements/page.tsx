import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { loadHiddenScope } from "@/lib/hiddenAccounts";
import { HiddenAccountsNotice } from "@/components/HiddenAccountsNotice";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/numbers";
import { loadReceivables } from "@/lib/receivables";

export const dynamic = "force-dynamic";

export default async function StatementsPage() {
  await requireAdmin();
  const hidden = await loadHiddenScope(true);

  const [customers, receivables] = await Promise.all([
    prisma.customer.findMany({
      where: hidden.customerIds.length
        ? { id: { notIn: hidden.customerIds } }
        : undefined,
      orderBy: { name: "asc" },
      select: { id: true, name: true, contactEmail: true },
    }),
    loadReceivables(new Date(), hidden),
  ]);
  const outstanding = new Map(
    receivables.byCustomer.map((c) => [c.customerId, c.balance]),
  );

  return (
    <div className="section">
      <PageHeader
        title="Customer statements"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Pick a customer to see their account statement — every invoice, payment and credit note with a running balance."
      />

      <HiddenAccountsNotice
        count={hidden.customerIds.length + hidden.partnerIds.length}
      />

      {customers.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No customers yet</p>
          <p className="empty-blurb">Add a customer, then their statement appears here.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact email</th>
                  <th className="col-num">Outstanding</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const bal = outstanding.get(c.id) ?? 0;
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-brand-navy">{c.name}</td>
                      <td className="text-slate-600">{c.contactEmail ?? "—"}</td>
                      <td className="col-num">
                        {bal > 0 ? formatMoney(bal) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/finance/customers/${c.id}/statement`}
                          className="text-brand-blue-dark hover:underline text-sm whitespace-nowrap"
                        >
                          Statement →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
