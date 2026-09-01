import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, toIsoDate, parseIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { loadPayslip } from "@/lib/payslip";
import { PayAdjustmentsEditor } from "./_components/PayAdjustmentsEditor";
import { PayslipEmailButton } from "./_components/PayslipEmailButton";

export const dynamic = "force-dynamic";

export default async function PayslipPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const from = parseIsoDate(searchParams.from) ?? monthStart;
  const to = parseIsoDate(searchParams.to, true) ?? monthEnd;

  const slip = await loadPayslip(params.id, from, to);
  if (!slip) notFound();

  const c = slip.currency;
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  return (
    <div className="section">
      <PageHeader
        title={`Payslip · ${slip.officer.name}`}
        backHref={`/finance/officers/${slip.officer.id}`}
        backLabel={slip.officer.name}
        subtitle={
          <>
            {formatDate(from)} – {formatDate(to)} · {slip.officer.role}
            {slip.officer.siaNumber ? ` · SIA ${slip.officer.siaNumber}` : ""}
          </>
        }
        actions={
          <>
            <a
              href={`/api/officers/${slip.officer.id}/payslip/pdf?from=${fromIso}&to=${toIso}`}
              className="btn-secondary text-sm"
            >
              Download PDF
            </a>
            <PayslipEmailButton
              officerId={slip.officer.id}
              email={slip.officer.email || null}
              from={fromIso}
              to={toIso}
            />
          </>
        }
      />

      {/* Period picker. */}
      <form className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={fromIso}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={toIso}
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          <a
            href={`/finance/officers/${slip.officer.id}/payslip?from=${toIsoDate(monthStart)}&to=${toIsoDate(monthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            This month
          </a>
          <a
            href={`/finance/officers/${slip.officer.id}/payslip?from=${toIsoDate(lastMonthStart)}&to=${toIsoDate(lastMonthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            Last month
          </a>
        </div>
      </form>

      {/* Payslip breakdown. */}
      <div className="card p-5 space-y-4">
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Earnings</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {slip.retainer && (
                <tr>
                  <td>
                    Monthly retainer
                    <span className="text-slate-500">
                      {" "}
                      · {formatMoney(slip.retainer.monthly, { currency: c })}/mo
                    </span>
                  </td>
                  <td className="col-num">{slip.retainer.months}</td>
                  <td className="col-num">
                    {formatMoney(slip.retainer.amount, { currency: c })}
                  </td>
                </tr>
              )}
              {slip.earnings.map((e) => (
                <tr key={e.service}>
                  <td>{e.service}</td>
                  <td className="col-num">{e.count}</td>
                  <td className="col-num">
                    {formatMoney(e.amount, { currency: c })}
                  </td>
                </tr>
              ))}
              {!slip.retainer && slip.earnings.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    No retainer or activity pay in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-end gap-1 text-sm">
          <div className="flex gap-8">
            <span className="text-slate-500">Gross pay</span>
            <span className="tabular-nums">{formatMoney(slip.gross, { currency: c })}</span>
          </div>
          {slip.adjustments.length > 0 && (
            <div className="flex gap-8">
              <span className="text-slate-500">Adjustments</span>
              <span
                className={
                  "tabular-nums " + (slip.adjustmentsTotal < 0 ? "text-red-600" : "")
                }
              >
                {formatMoney(slip.adjustmentsTotal, { currency: c })}
              </span>
            </div>
          )}
          <div className="flex gap-8 text-base font-semibold text-brand-navy">
            <span>Net pay</span>
            <span className="tabular-nums">{formatMoney(slip.net, { currency: c })}</span>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {slip.activityCount} paid{" "}
          {slip.activityCount === 1 ? "activity" : "activities"} in this period.
          Pay is before any statutory PAYE/NI deductions unless entered as an
          adjustment.
        </p>
      </div>

      <PayAdjustmentsEditor
        officerId={slip.officer.id}
        currency={c}
        defaultDate={fromIso}
        adjustments={slip.adjustments.map((a) => ({
          id: a.id,
          date: a.date.toISOString(),
          kind: a.kind,
          label: a.label,
          amount: a.amount,
          note: a.note,
        }))}
      />
    </div>
  );
}
