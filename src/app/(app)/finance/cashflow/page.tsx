import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/numbers";
import { loadCashflow } from "@/lib/cashflow";

export const dynamic = "force-dynamic";

function fmtWeek(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
  }).format(d);
}

export default async function CashflowPage({
  searchParams,
}: {
  searchParams: { opening?: string };
}) {
  await requireAdmin();

  const openingRaw = Number(searchParams.opening);
  const opening = Number.isFinite(openingRaw) ? openingRaw : 0;
  const f = await loadCashflow(new Date(), 12, opening);

  const balNeg = f.lowestBalance < 0;

  return (
    <div className="section">
      <PageHeader
        title="Cash flow forecast"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Money in vs money out over the next 12 weeks, with a running position — so you can see a squeeze coming."
      />

      {/* Opening balance — no bank feed, so you tell us where you're starting. */}
      <form className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="opening">
            Opening bank balance
          </label>
          <input
            id="opening"
            name="opening"
            type="number"
            inputMode="decimal"
            step="0.01"
            defaultValue={opening || ""}
            placeholder="0.00"
            autoComplete="off"
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        <p className="text-xs text-slate-500 max-w-md">
          There's no bank connection, so enter today's balance to see the real
          running position. Leave blank to see the net movement from £0.
        </p>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="kpi">
          <div className="kpi-label">Money in (12 wks)</div>
          <div className="kpi-value text-success">{formatMoney(f.totalIn)}</div>
          <div className="kpi-hint">invoices due</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Money out (12 wks)</div>
          <div className="kpi-value text-red-600">{formatMoney(f.totalOut)}</div>
          <div className="kpi-hint">bills + payroll</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Net movement</div>
          <div
            className={"kpi-value " + (f.net >= 0 ? "text-success" : "text-red-600")}
          >
            {formatMoney(f.net)}
          </div>
          <div className="kpi-hint">in − out</div>
        </div>
        <div className={balNeg ? "card-accent p-5 flex flex-col gap-1.5" : "kpi"}>
          <div className="kpi-label">Lowest point</div>
          <div
            className={
              "kpi-value " + (balNeg ? "text-red-600" : "text-brand-navy")
            }
          >
            {formatMoney(f.lowestBalance)}
          </div>
          <div className="kpi-hint">
            {f.lowestWeekStart ? `week of ${fmtWeek(f.lowestWeekStart)}` : "—"}
          </div>
        </div>
      </div>

      {balNeg && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Heads up — on these figures the running balance goes negative
          {f.lowestWeekStart ? ` around the week of ${fmtWeek(f.lowestWeekStart)}` : ""}.
          Chase overdue invoices or defer a bill to stay in the black.
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Weekly forecast</h2>
          <p className="text-xs text-slate-500">
            Payroll is estimated at {formatMoney(f.monthlyPayroll)}/month (last
            month's total), applied at each month-end.
          </p>
        </div>
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Week starting</th>
                <th className="col-num">Money in</th>
                <th className="col-num">Money out</th>
                <th className="col-num">Net</th>
                <th className="col-num">Running balance</th>
              </tr>
            </thead>
            <tbody>
              {f.weeks.map((w) => (
                <tr key={w.start.toISOString()}>
                  <td className="whitespace-nowrap tabular-nums">
                    {fmtWeek(w.start)}
                  </td>
                  <td className="col-num text-success">
                    {w.inflow > 0 ? formatMoney(w.inflow) : "—"}
                  </td>
                  <td className="col-num text-red-600">
                    {w.outflow > 0 ? formatMoney(w.outflow) : "—"}
                  </td>
                  <td
                    className={
                      "col-num " + (w.net >= 0 ? "text-slate-700" : "text-red-600")
                    }
                  >
                    {formatMoney(w.net)}
                  </td>
                  <td
                    className={
                      "col-num font-medium " +
                      (w.balance < 0 ? "text-red-600" : "text-brand-navy")
                    }
                  >
                    {formatMoney(w.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-subtle p-4 text-sm text-slate-600 space-y-1">
        <p className="font-medium text-brand-navy">What's in the forecast</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>In:</strong> outstanding customer invoices, on their due date
            (overdue ones in the first week).
          </li>
          <li>
            <strong>Out:</strong> unpaid supplier bills on their due date, plus
            the monthly payroll estimate at each month-end.
          </li>
          <li>
            Not included yet: VAT payments, un-invoiced recurring revenue, and
            costs you haven't recorded. Keep{" "}
            <span className="font-medium">Receivables</span> and{" "}
            <span className="font-medium">Payables</span> up to date for the
            forecast to be accurate.
          </li>
        </ul>
      </div>
    </div>
  );
}
