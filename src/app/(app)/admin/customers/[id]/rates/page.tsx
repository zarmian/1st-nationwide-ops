import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { RateCardForm } from "@/components/RateCardForm";
import { DeleteRateButton } from "@/components/DeleteRateButton";
import { SERVICE_LABEL, UNIT_LABEL, fmtMoney } from "@/lib/rateMeta";
import { upsertCustomerRate, deleteCustomerRate } from "./_actions";

export const dynamic = "force-dynamic";

export default async function CustomerRatesPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      rates: { orderBy: { service: "asc" } },
      _count: { select: { sites: true } },
    },
  });
  if (!customer) notFound();

  const action = upsertCustomerRate.bind(null, customer.id);

  return (
    <div className="section">
      <PageHeader
        title={`${customer.name} — rate card`}
        backHref="/admin/customers"
        backLabel="Customers"
        subtitle={
          <>
            Default prices for this customer. They apply to all{" "}
            {customer._count.sites} site
            {customer._count.sites === 1 ? "" : "s"} automatically — a site only
            needs its own rate when it differs (set that on the site&apos;s
            Finance tab).
          </>
        }
      />

      <RateCardForm action={action} />

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Default rates</h2>
          <p className="text-xs text-slate-500">
            What we charge per service unless a site overrides it.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Service
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Amount
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Unit
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Notes
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customer.rates.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  {SERVICE_LABEL[r.service] ?? r.service}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                  {fmtMoney(r.amount, r.currency)}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {UNIT_LABEL[r.unit] ?? r.unit}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs">
                  {r.notes ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <DeleteRateButton id={r.id} remove={deleteCustomerRate} />
                </td>
              </tr>
            ))}
            {customer.rates.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-slate-500 text-sm"
                >
                  No default rates yet. Add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
