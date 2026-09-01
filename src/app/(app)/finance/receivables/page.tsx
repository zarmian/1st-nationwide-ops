import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import {
  loadReceivables,
  BUCKET_ORDER,
  BUCKET_LABEL,
  type AgedBucket,
} from "@/lib/receivables";

export const dynamic = "force-dynamic";

// Ageing chips get hotter the longer a balance is overdue.
const BUCKET_CHIP: Record<AgedBucket, string> = {
  current: "chip-slate",
  d1_30: "chip-info",
  d31_60: "chip-amber",
  d61_90: "chip-amber",
  d90_plus: "chip-red",
};

export default async function ReceivablesPage() {
  await requireAdmin();
  const data = await loadReceivables();

  return (
    <div className="section">
      <PageHeader
        title="Receivables"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Outstanding customer invoices, aged by how long they've been due. Overdue invoices are reminded automatically each day (once email is set up)."
        actions={
          <Link href="/finance/invoices" className="btn-secondary text-sm">
            Invoices →
          </Link>
        }
      />

      {/* Ageing summary — total outstanding plus a card per bucket. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <div className="card-accent p-4 flex flex-col gap-1">
          <div className="kpi-label">Outstanding</div>
          <div className="kpi-value">{formatMoney(data.totalOutstanding)}</div>
          <div className="kpi-hint">
            {data.count} {data.count === 1 ? "invoice" : "invoices"}
          </div>
        </div>
        {BUCKET_ORDER.map((b) => (
          <div key={b} className="kpi">
            <div className="kpi-label">{BUCKET_LABEL[b]}</div>
            <div className="kpi-value text-xl">
              {formatMoney(data.buckets[b])}
            </div>
          </div>
        ))}
      </div>

      {data.count === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Nothing outstanding</p>
          <p className="empty-blurb">
            Every issued invoice is fully paid. Send an invoice from{" "}
            <Link href="/finance/invoices" className="text-brand-blue-dark hover:underline">
              Invoices
            </Link>{" "}
            and it'll appear here until it's settled.
          </p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="font-semibold text-brand-navy">Outstanding invoices</h2>
              <p className="text-xs text-slate-500">
                Most overdue first. Click a number to record a payment or chase it.
              </p>
            </div>
            <div className="table-scroll">
              <table className="table-default">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Customer</th>
                    <th>Due</th>
                    <th className="col-num">Overdue</th>
                    <th className="col-num">Total</th>
                    <th className="col-num">Paid</th>
                    <th className="col-num">Balance</th>
                    <th>Age</th>
                    <th>Reminded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          href={`/finance/invoices/${r.id}`}
                          className="text-brand-blue-dark hover:underline font-medium"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td>{r.customerName}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDate(r.dueAt)}
                      </td>
                      <td className="col-num">
                        {r.daysOverdue > 0 ? (
                          <span className="text-red-600">{r.daysOverdue}d</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="col-num text-slate-600">
                        {formatMoney(r.total)}
                      </td>
                      <td className="col-num text-slate-600">
                        {formatMoney(r.paid)}
                      </td>
                      <td className="col-num font-medium">
                        {formatMoney(r.balance)}
                      </td>
                      <td>
                        <span className={BUCKET_CHIP[r.bucket]}>
                          {BUCKET_LABEL[r.bucket]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-slate-500">
                        {r.lastRemindedAt ? formatDate(r.lastRemindedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.byCustomer.length > 1 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-brand-navy">By customer</h2>
                <p className="text-xs text-slate-500">
                  Total outstanding balance per customer.
                </p>
              </div>
              <div className="table-scroll">
                <table className="table-default">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="col-num">Outstanding</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCustomer.map((c) => (
                      <tr key={c.customerId}>
                        <td className="font-medium text-brand-navy">
                          {c.customerName}
                        </td>
                        <td className="col-num">{formatMoney(c.balance)}</td>
                        <td className="text-right">
                          <Link
                            href={`/finance/customers/${c.customerId}/statement`}
                            className="text-brand-blue-dark hover:underline text-sm whitespace-nowrap"
                          >
                            Statement →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
