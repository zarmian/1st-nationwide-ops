import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, toIsoDate, parseIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { loadCosts, COST_CATEGORIES } from "@/lib/costs";
import { CostsEditor } from "./_components/CostsEditor";

export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const from = parseIsoDate(searchParams.from) ?? monthStart;
  const to = parseIsoDate(searchParams.to, true) ?? monthEnd;
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  const data = await loadCosts(from, to);

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  return (
    <div className="section">
      <PageHeader
        title="Supplier costs"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Bills and overheads — subcontractors, fuel, vehicles, kit, insurance. Feeds the VAT return (Box 4) and true net profit."
        actions={
          <a
            href={`/api/finance/export/costs?from=${fromIso}&to=${toIso}`}
            download
            className="btn-secondary text-sm"
          >
            Download CSV
          </a>
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
            href={`/finance/costs?from=${toIsoDate(monthStart)}&to=${toIsoDate(monthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            This month
          </a>
          <a
            href={`/finance/costs?from=${toIsoDate(lastMonthStart)}&to=${toIsoDate(lastMonthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            Last month
          </a>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card-accent p-4 flex flex-col gap-1">
          <div className="kpi-label">Total (gross)</div>
          <div className="kpi-value">{formatMoney(data.gross)}</div>
          <div className="kpi-hint">
            {data.rows.length} {data.rows.length === 1 ? "bill" : "bills"} ·{" "}
            {formatDate(from)} – {formatDate(to)}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Net</div>
          <div className="kpi-value text-xl">{formatMoney(data.net)}</div>
          <div className="kpi-hint">Box 7 · purchases ex VAT</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">VAT</div>
          <div className="kpi-value text-xl">{formatMoney(data.vat)}</div>
          <div className="kpi-hint">on all bills</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Reclaimable VAT</div>
          <div className="kpi-value text-xl">{formatMoney(data.reclaimableVat)}</div>
          <div className="kpi-hint">Box 4 · input VAT</div>
        </div>
      </div>

      {data.byCategory.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">By category</h2>
            <p className="text-xs text-slate-500">Where the money went, in range.</p>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="col-num">Bills</th>
                  <th className="col-num">Net</th>
                  <th className="col-num">VAT</th>
                  <th className="col-num">Gross</th>
                </tr>
              </thead>
              <tbody>
                {data.byCategory.map((r) => (
                  <tr key={r.category}>
                    <td className="font-medium text-brand-navy">{r.category}</td>
                    <td className="col-num">{r.count}</td>
                    <td className="col-num">{formatMoney(r.net)}</td>
                    <td className="col-num">{formatMoney(r.vat)}</td>
                    <td className="col-num">{formatMoney(r.gross)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="text-brand-navy">Total</td>
                  <td className="col-num">{data.rows.length}</td>
                  <td className="col-num">{formatMoney(data.net)}</td>
                  <td className="col-num">{formatMoney(data.vat)}</td>
                  <td className="col-num">{formatMoney(data.gross)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CostsEditor
        categories={COST_CATEGORIES}
        defaultDate={fromIso}
        costs={data.rows.map((c) => ({
          id: c.id,
          date: c.date.toISOString(),
          supplier: c.supplier,
          category: c.category,
          description: c.description,
          net: c.net,
          vatRate: c.vatRate,
          vatAmount: c.vatAmount,
          gross: c.gross,
          reference: c.reference,
          reclaimable: c.reclaimable,
          notes: c.notes,
        }))}
      />
    </div>
  );
}
