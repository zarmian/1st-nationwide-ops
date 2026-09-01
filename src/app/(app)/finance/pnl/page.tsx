import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, toIsoDate, parseIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { loadPnl, type PnlFigures } from "@/lib/pnl";
import { PrintButton } from "./_components/PrintButton";
import { COMPANY } from "@/lib/company";

export const dynamic = "force-dynamic";

function pctChange(cur: number, prev: number): string {
  if (!prev) return "—";
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

type LineDef = {
  label: string;
  key: keyof PnlFigures;
  /** cost lines render as a deduction. */
  deduct?: boolean;
  strong?: boolean;
  net?: boolean;
};

const LINES: LineDef[] = [
  { label: "Revenue", key: "revenue" },
  { label: "Officer pay", key: "officerPay", deduct: true },
  { label: "Subcontractors", key: "subcontractors", deduct: true },
  { label: "Gross profit", key: "grossProfit", strong: true },
  { label: "Overheads", key: "overheads", deduct: true },
  { label: "Net profit", key: "netProfit", strong: true, net: true },
];

export default async function PnlPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const from = parseIsoDate(searchParams.from) ?? lastMonthStart;
  const to = parseIsoDate(searchParams.to, true) ?? lastMonthEnd;
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  const r = await loadPnl(from, to);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

  return (
    <div className="section">
      <PageHeader
        title="Profit & loss"
        backHref="/finance"
        backLabel="Finance"
        subtitle={`${COMPANY.name} · ${formatDate(from)} – ${formatDate(to)}`}
        actions={<PrintButton />}
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
            href={`/finance/pnl?from=${toIsoDate(lastMonthStart)}&to=${toIsoDate(lastMonthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            Last month
          </a>
          <a
            href={`/finance/pnl?from=${toIsoDate(monthStart)}&to=${toIsoDate(monthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            This month
          </a>
          <a
            href={`/finance/pnl?from=${toIsoDate(yearStart)}&to=${toIsoDate(yearEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            This year
          </a>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="kpi">
          <div className="kpi-label">Revenue</div>
          <div className="kpi-value">{formatMoney(r.current.revenue)}</div>
          <div className="kpi-hint">
            {pctChange(r.current.revenue, r.previous.revenue)} vs previous
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Gross profit</div>
          <div className="kpi-value">{formatMoney(r.current.grossProfit)}</div>
          <div className="kpi-hint">
            {r.current.revenue > 0
              ? `${Math.round((r.current.grossProfit / r.current.revenue) * 100)}% margin`
              : "—"}
          </div>
        </div>
        <div className="card-accent p-5 flex flex-col gap-1.5">
          <div className="kpi-label">Net profit</div>
          <div
            className={
              "kpi-value " + (r.current.netProfit >= 0 ? "text-success" : "text-red-600")
            }
          >
            {formatMoney(r.current.netProfit)}
          </div>
          <div className="kpi-hint">
            {pctChange(r.current.netProfit, r.previous.netProfit)} vs previous
          </div>
        </div>
      </div>

      {/* The statement. */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Statement</h2>
          <p className="text-xs text-slate-500">
            Previous period: {formatDate(r.prevFrom)} – {formatDate(r.prevTo)}.
          </p>
        </div>
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th></th>
                <th className="col-num">This period</th>
                <th className="col-num">Previous</th>
                <th className="col-num">Change</th>
              </tr>
            </thead>
            <tbody>
              {LINES.map((l) => {
                const cur = r.current[l.key];
                const prev = r.previous[l.key];
                const show = (n: number) =>
                  l.deduct ? `− ${formatMoney(Math.abs(n))}` : formatMoney(n);
                return (
                  <tr
                    key={l.key}
                    className={l.strong ? "bg-slate-50 font-semibold" : ""}
                  >
                    <td className={l.strong ? "text-brand-navy" : "text-slate-600"}>
                      {l.label}
                    </td>
                    <td
                      className={
                        "col-num " +
                        (l.net
                          ? cur >= 0
                            ? "text-success"
                            : "text-red-600"
                          : l.deduct
                            ? "text-slate-600"
                            : "text-brand-navy")
                      }
                    >
                      {show(cur)}
                    </td>
                    <td className="col-num text-slate-500">{show(prev)}</td>
                    <td className="col-num text-xs text-slate-500">
                      {pctChange(cur, prev)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {r.revenueByService.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Revenue by service</h2>
            <p className="text-xs text-slate-500">Where the revenue came from.</p>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="col-num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {r.revenueByService.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="col-num">{formatMoney(s.value)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="text-brand-navy">Total</td>
                  <td className="col-num">{formatMoney(r.current.revenue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card-subtle p-4 text-sm text-slate-600 space-y-1">
        <p className="font-medium text-brand-navy">How this is worked out</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Revenue</strong> is billed activity in the period;{" "}
            <strong>officer pay</strong> and <strong>subcontractor</strong>{" "}
            charges are the direct cost of that work.
          </li>
          <li>
            <strong>Overheads</strong> are the net value of supplier costs by
            bill date. If you record a subcontractor's invoice as a supplier
            cost, don't also let it count as a partner charge — that would
            double-count it.
          </li>
          <li>Figures use the scheduled (accounting) date, matching the rest of finance.</li>
        </ul>
      </div>
    </div>
  );
}
