import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, toIsoDate, parseIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import {
  loadVatReturn,
  recentQuarters,
  currentQuarter,
} from "@/lib/vatReturn";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  SENT: "chip-info",
  PAID: "chip-green",
};

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default async function VatReturnPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  const thisQuarter = currentQuarter(now);
  const from = parseIsoDate(searchParams.from) ?? thisQuarter.from;
  const to = parseIsoDate(searchParams.to, true) ?? thisQuarter.to;

  const vat = await loadVatReturn(from, to);
  const quarters = recentQuarters(now, 5);

  return (
    <div className="section">
      <PageHeader
        title="VAT return"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Output VAT you've charged customers, by invoice date — ready to transcribe onto your HMRC return."
        actions={
          <Link href="/finance/invoices" className="btn-secondary text-sm">
            Invoices →
          </Link>
        }
      />

      {/* Period picker — quarter presets plus a manual range. */}
      <form className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={toIsoDate(from)}
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
            defaultValue={toIsoDate(to)}
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          {quarters.map((q) => (
            <a
              key={q.label}
              href={`/finance/vat?from=${toIsoDate(q.from)}&to=${toIsoDate(q.to)}`}
              className="chip-slate hover:bg-slate-200 cursor-pointer"
            >
              {q.label}
            </a>
          ))}
        </div>
      </form>

      {/* The two figures that go on the return. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-accent p-5 flex flex-col gap-1">
          <div className="kpi-label">Box 1 · VAT due on sales</div>
          <div className="kpi-value">{formatMoney(vat.vatDueOnSales)}</div>
          <div className="kpi-hint">Output VAT charged in the period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Box 6 · Sales excluding VAT</div>
          <div className="kpi-value">{formatMoney(vat.netSales)}</div>
          <div className="kpi-hint">Net value of invoices</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Gross billed</div>
          <div className="kpi-value">{formatMoney(vat.gross)}</div>
          <div className="kpi-hint">
            {vat.count} {vat.count === 1 ? "invoice" : "invoices"} ·{" "}
            {formatDate(from)} – {formatDate(to)}
          </div>
        </div>
      </div>

      {/* Split by VAT rate — matters if any invoice used a non-standard rate. */}
      {vat.byRate.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">By VAT rate</h2>
            <p className="text-xs text-slate-500">
              Net and VAT grouped by the rate applied on each invoice.
            </p>
          </div>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Rate</th>
                  <th className="col-num">Invoices</th>
                  <th className="col-num">Net</th>
                  <th className="col-num">VAT</th>
                </tr>
              </thead>
              <tbody>
                {vat.byRate.map((r) => (
                  <tr key={r.rate}>
                    <td>{pct(r.rate)}</td>
                    <td className="col-num">{r.count}</td>
                    <td className="col-num">{formatMoney(r.net)}</td>
                    <td className="col-num">{formatMoney(r.vat)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="text-brand-navy">Total</td>
                  <td className="col-num">{vat.count}</td>
                  <td className="col-num">{formatMoney(vat.netSales)}</td>
                  <td className="col-num">{formatMoney(vat.vatDueOnSales)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice-level breakdown — the audit trail behind the totals. */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Invoices in this period</h2>
          <p className="text-xs text-slate-500">
            By invoice (tax point) date. Drafts and voided invoices are excluded.
          </p>
        </div>
        {vat.invoices.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-500">
            No invoices were issued in this period.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Issued</th>
                  <th className="col-num">Net</th>
                  <th className="col-num">VAT</th>
                  <th className="col-num">Gross</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vat.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link
                        href={`/finance/invoices/${inv.id}`}
                        className="text-brand-blue-dark hover:underline font-medium"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td>{inv.customerName}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(inv.issuedAt)}
                    </td>
                    <td className="col-num">{formatMoney(inv.net)}</td>
                    <td className="col-num">{formatMoney(inv.vat)}</td>
                    <td className="col-num">{formatMoney(inv.gross)}</td>
                    <td>
                      <span className={STATUS_CHIP[inv.status] ?? "chip-slate"}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-subtle p-4 text-sm text-slate-600 space-y-1">
        <p className="font-medium text-brand-navy">Before you file</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            This is <strong>output VAT only</strong> (VAT on your sales). Input
            VAT on purchases (Box 4) isn't tracked here — add it from your
            bookkeeping.
          </li>
          <li>
            Figures use the <strong>invoice date</strong> as the tax point
            (accrual basis). If you're on the cash accounting scheme, VAT is due
            when paid instead.
          </li>
          <li>
            Confirm your VAT quarter dates match HMRC's — staggered quarters
            differ from the calendar quarters offered above.
          </li>
        </ul>
      </div>
    </div>
  );
}
