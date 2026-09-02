import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { loadHiddenScope } from "@/lib/hiddenAccounts";
import { HiddenAccountsNotice } from "@/components/HiddenAccountsNotice";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import {
  loadPayables,
  BUCKET_ORDER,
  BUCKET_LABEL,
  type AgedBucket,
} from "@/lib/payables";
import { MarkPaidButton } from "./_components/MarkPaidButton";

export const dynamic = "force-dynamic";

const BUCKET_CHIP: Record<AgedBucket, string> = {
  current: "chip-slate",
  d1_30: "chip-info",
  d31_60: "chip-amber",
  d61_90: "chip-amber",
  d90_plus: "chip-red",
};

export default async function PayablesPage() {
  await requireAdmin();
  const hidden = await loadHiddenScope(true);
  const data = await loadPayables(new Date(), hidden);

  return (
    <div className="section">
      <PageHeader
        title="Payables"
        backHref="/finance"
        backLabel="Finance"
        subtitle="What you owe — unpaid supplier bills, aged by due date, plus what you owe subcontractor partners."
        actions={
          <Link href="/finance/costs" className="btn-secondary text-sm">
            All costs →
          </Link>
        }
      />

      <HiddenAccountsNotice
        count={hidden.customerIds.length + hidden.partnerIds.length}
      />

      {/* Ageing summary. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <div className="card-accent p-4 flex flex-col gap-1">
          <div className="kpi-label">Owed to suppliers</div>
          <div className="kpi-value">{formatMoney(data.totalOutstanding)}</div>
          <div className="kpi-hint">
            {data.count} {data.count === 1 ? "bill" : "bills"}
          </div>
        </div>
        {BUCKET_ORDER.map((b) => (
          <div key={b} className="kpi">
            <div className="kpi-label">{BUCKET_LABEL[b]}</div>
            <div className="kpi-value text-xl">{formatMoney(data.buckets[b])}</div>
          </div>
        ))}
      </div>

      {data.count === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No unpaid supplier bills</p>
          <p className="empty-blurb">
            Record bills on{" "}
            <Link href="/finance/costs" className="text-brand-blue-dark hover:underline">
              Costs
            </Link>{" "}
            with a due date, and the outstanding ones show here until you mark
            them paid.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Unpaid bills</h2>
            <p className="text-xs text-slate-500">
              Most overdue first. Mark a bill paid once it's settled.
            </p>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Category</th>
                  <th>Due</th>
                  <th className="col-num">Overdue</th>
                  <th className="col-num">Amount</th>
                  <th>Age</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-brand-navy">
                      {r.supplier}
                      {r.reference ? (
                        <span className="font-normal text-slate-500">
                          {" "}
                          · {r.reference}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-slate-600">{r.category}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(r.dueDate)}
                    </td>
                    <td className="col-num">
                      {r.daysOverdue > 0 ? (
                        <span className="text-red-600">{r.daysOverdue}d</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="col-num font-medium">{formatMoney(r.gross)}</td>
                    <td>
                      <span className={BUCKET_CHIP[r.bucket]}>
                        {BUCKET_LABEL[r.bucket]}
                      </span>
                    </td>
                    <td className="text-right">
                      <MarkPaidButton id={r.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.bySupplier.length > 1 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">By supplier</h2>
            <p className="text-xs text-slate-500">Outstanding per supplier.</p>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="col-num">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {data.bySupplier.map((s) => (
                  <tr key={s.supplier}>
                    <td className="font-medium text-brand-navy">{s.supplier}</td>
                    <td className="col-num">{formatMoney(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Partner charges — informational; settled outside this ledger. */}
      {data.partnerOwings.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between gap-3">
            <div>
              <h2 className="font-semibold text-brand-navy">Owed to partners</h2>
              <p className="text-xs text-slate-500">
                What subcontractor partners have charged us for work done on our
                behalf. Reconcile and settle via each partner's statement.
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-brand-navy tabular-nums leading-none">
                {formatMoney(data.partnerOwingsTotal)}
              </div>
              <div className="text-[11px] text-slate-500">total</div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th className="col-num">Charged to us</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.partnerOwings.map((p) => (
                  <tr key={p.partnerId}>
                    <td className="font-medium text-brand-navy">{p.partnerName}</td>
                    <td className="col-num">{formatMoney(p.amount)}</td>
                    <td className="text-right">
                      <Link
                        href={`/finance/partners/${p.partnerId}/statement`}
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
    </div>
  );
}
