import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import { loadContracts } from "@/lib/contracts";
import { ContractsEditor } from "./_components/ContractsEditor";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  await requireAdmin();
  const [customers, data] = await Promise.all([
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadContracts(),
  ]);

  return (
    <div className="section">
      <PageHeader
        title="Contracts"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Customer service agreements and their renewal dates — so a contract never quietly lapses."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-accent p-5 flex flex-col gap-1.5">
          <div className="kpi-label">Annual contract value</div>
          <div className="kpi-value">{formatMoney(data.annualisedValue)}</div>
          <div className="kpi-hint">
            {data.activeCount} active{" "}
            {data.activeCount === 1 ? "contract" : "contracts"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Active contracts</div>
          <div className="kpi-value">{data.activeCount}</div>
          <div className="kpi-hint">currently in force</div>
        </div>
        <div
          className={
            data.renewingSoonCount > 0
              ? "card-accent p-5 flex flex-col gap-1.5"
              : "kpi"
          }
        >
          <div className="kpi-label">Renewing soon</div>
          <div
            className={
              "kpi-value " +
              (data.renewingSoonCount > 0 ? "text-amber-700" : "text-brand-navy")
            }
          >
            {data.renewingSoonCount}
          </div>
          <div className="kpi-hint">need attention</div>
        </div>
      </div>

      {data.renewingSoon.length > 0 && (
        <div className="card overflow-hidden border-amber-200">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Renewing soon</h2>
            <p className="text-xs text-slate-500">
              Active contracts at or near their renewal date — chase or re-price
              before they lapse.
            </p>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Customer</th>
                  <th>Renewal date</th>
                  <th className="col-num">In</th>
                  <th className="col-num">Per year</th>
                </tr>
              </thead>
              <tbody>
                {data.renewingSoon.map((r) => {
                  const overdue = (r.daysUntilRenewal ?? 0) < 0;
                  return (
                    <tr key={r.id}>
                      <td className="font-medium text-brand-navy">{r.title}</td>
                      <td>
                        <Link
                          href={`/finance/customers/${r.customerId}/statement`}
                          className="text-brand-blue-dark hover:underline"
                        >
                          {r.customerName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {r.endDate ? formatDate(r.endDate) : "—"}
                      </td>
                      <td
                        className={
                          "col-num " +
                          (overdue ? "text-red-600 font-medium" : "text-amber-700")
                        }
                      >
                        {overdue
                          ? `${Math.abs(r.daysUntilRenewal ?? 0)}d ago`
                          : `${r.daysUntilRenewal}d`}
                      </td>
                      <td className="col-num">{formatMoney(r.annualised)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ContractsEditor
        customers={customers}
        contracts={data.rows.map((r) => ({
          id: r.id,
          customerName: r.customerName,
          title: r.title,
          value: r.value,
          cadence: r.cadence,
          annualised: r.annualised,
          startDate: r.startDate.toISOString(),
          endDate: r.endDate ? r.endDate.toISOString() : null,
          status: r.status,
          daysUntilRenewal: r.daysUntilRenewal,
          renewingSoon: r.renewingSoon,
          notes: r.notes,
        }))}
      />
    </div>
  );
}
