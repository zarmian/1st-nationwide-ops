import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, toIsoDate, parseIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { loadCustomerStatement } from "@/lib/customerStatement";
import { StatementEmailButton } from "./_components/StatementEmailButton";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Credit note",
};

export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  // Default: the last three whole months up to today.
  const defFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const defTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const from = parseIsoDate(searchParams.from) ?? defFrom;
  const to = parseIsoDate(searchParams.to, true) ?? defTo;
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  const st = await loadCustomerStatement(params.id, from, to);
  if (!st) notFound();

  const c = st.currency;
  const base = `/finance/customers/${st.customer.id}/statement`;
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

  return (
    <div className="section">
      <PageHeader
        title={`Statement · ${st.customer.name}`}
        backHref="/finance/statements"
        backLabel="Statements"
        subtitle={
          <>
            {formatDate(from)} – {formatDate(to)}
            {st.customer.contactEmail ? ` · ${st.customer.contactEmail}` : ""}
          </>
        }
        actions={
          <>
            <a
              href={`/api/customers/${st.customer.id}/statement/pdf?from=${fromIso}&to=${toIso}`}
              className="btn-secondary text-sm"
            >
              Download PDF
            </a>
            <StatementEmailButton
              customerId={st.customer.id}
              email={st.customer.contactEmail || null}
              from={fromIso}
              to={toIso}
            />
          </>
        }
      />

      <form className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={fromIso} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={toIso} className="input" />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          <a
            href={`${base}?from=${toIsoDate(defFrom)}&to=${toIsoDate(defTo)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            Last 3 months
          </a>
          <a
            href={`${base}?from=${toIsoDate(yearStart)}&to=${toIsoDate(yearEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            This year
          </a>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="kpi">
          <div className="kpi-label">Opening balance</div>
          <div className="kpi-value text-xl">{formatMoney(st.openingBalance, { currency: c })}</div>
          <div className="kpi-hint">at {formatDate(from)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Invoiced − paid − credited</div>
          <div className="kpi-value text-xl">
            {formatMoney(st.totalInvoiced, { currency: c })} ·{" "}
            {formatMoney(st.totalPaid, { currency: c })} ·{" "}
            {formatMoney(st.totalCredited, { currency: c })}
          </div>
          <div className="kpi-hint">movements in range</div>
        </div>
        <div className="card-accent p-4 flex flex-col gap-1">
          <div className="kpi-label">Balance due</div>
          <div className="kpi-value">{formatMoney(st.closingBalance, { currency: c })}</div>
          <div className="kpi-hint">at {formatDate(to)}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Date</th>
                <th>Detail</th>
                <th>Type</th>
                <th className="col-num">Amount</th>
                <th className="col-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50/60">
                <td></td>
                <td className="text-slate-500">Opening balance</td>
                <td></td>
                <td className="col-num"></td>
                <td className="col-num">{formatMoney(st.openingBalance, { currency: c })}</td>
              </tr>
              {st.lines.map((l, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(l.date)}</td>
                  <td>{l.description}</td>
                  <td>
                    <span className="chip-slate text-[10px]">{TYPE_LABEL[l.type]}</span>
                  </td>
                  <td className={"col-num " + (l.amount < 0 ? "text-red-600" : "")}>
                    {formatMoney(l.amount, { currency: c })}
                  </td>
                  <td className="col-num">{formatMoney(l.balance, { currency: c })}</td>
                </tr>
              ))}
              {st.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No invoices, payments or credit notes in this period.
                  </td>
                </tr>
              )}
              <tr className="bg-slate-50 font-medium">
                <td></td>
                <td className="text-brand-navy">Balance due</td>
                <td></td>
                <td className="col-num"></td>
                <td className="col-num">{formatMoney(st.closingBalance, { currency: c })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
