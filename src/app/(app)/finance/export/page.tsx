import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, toIsoDate, parseIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { accountingCounts } from "@/lib/accountingExport";

export const dynamic = "force-dynamic";

function ExportCard({
  title,
  blurb,
  href,
  count,
  total,
  disabled,
}: {
  title: string;
  blurb: string;
  href: string;
  count: number;
  total?: string;
  disabled?: boolean;
}) {
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex-1">
        <h2 className="font-semibold text-brand-navy">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">{blurb}</p>
        <p className="text-sm text-slate-700 mt-3 tabular-nums">
          {count} {count === 1 ? "row" : "rows"}
          {total ? ` · ${total}` : ""}
        </p>
      </div>
      {disabled ? (
        <span className="btn-secondary text-sm opacity-50 cursor-not-allowed inline-flex items-center gap-1.5 self-start">
          <Download size={14} /> Nothing to export
        </span>
      ) : (
        <a
          href={href}
          download
          className="btn-primary text-sm inline-flex items-center gap-1.5 self-start"
        >
          <Download size={14} /> Download CSV
        </a>
      )}
    </div>
  );
}

export default async function AccountingExportPage({
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
  const qs = `from=${fromIso}&to=${toIso}`;

  const counts = await accountingCounts(from, to);

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  return (
    <div className="section">
      <PageHeader
        title="Accounting export"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Download CSVs for your bookkeeper or accounting software (Xero, QuickBooks, Sage)."
      />

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
            href={`/finance/export?from=${toIsoDate(monthStart)}&to=${toIsoDate(monthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            This month
          </a>
          <a
            href={`/finance/export?from=${toIsoDate(lastMonthStart)}&to=${toIsoDate(lastMonthEnd)}`}
            className="chip-slate hover:bg-slate-200 cursor-pointer"
          >
            Last month
          </a>
        </div>
      </form>

      <p className="text-xs text-slate-500">
        Covering {formatDate(from)} – {formatDate(to)}. Dates in the files are
        ISO format (YYYY-MM-DD).
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <ExportCard
          title="Sales (invoices)"
          blurb="One row per issued invoice by invoice date — net, VAT and gross, plus paid and balance. Drafts and voided invoices are excluded."
          href={`/api/finance/export/invoices?${qs}`}
          count={counts.invoices}
          total={formatMoney(counts.sales)}
          disabled={counts.invoices === 0}
        />
        <ExportCard
          title="Payments received"
          blurb="One row per payment by payment date, with method and reference — for reconciling against the bank."
          href={`/api/finance/export/payments?${qs}`}
          count={counts.payments}
          total={formatMoney(counts.received)}
          disabled={counts.payments === 0}
        />
        <div className="card p-5 flex flex-col gap-3">
          <div className="flex-1">
            <h2 className="font-semibold text-brand-navy">Payroll</h2>
            <p className="text-xs text-slate-500 mt-1">
              One row per officer for the period — retainer, activity pay,
              adjustments and net. Same figures as the Payroll page.
            </p>
          </div>
          <a
            href={`/api/payroll/export?${qs}`}
            download
            className="btn-primary text-sm inline-flex items-center gap-1.5 self-start"
          >
            <Download size={14} /> Download CSV
          </a>
        </div>
      </div>

      <div className="card-subtle p-4 text-sm text-slate-600 space-y-1">
        <p className="font-medium text-brand-navy">Importing these</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Every cell is quoted, so names with commas or quotes import cleanly.
          </li>
          <li>
            Sales uses the invoice (tax-point) date; payments use the date the
            money came in — so the two reconcile against your VAT return and
            bank statement respectively.
          </li>
          <li>
            Need a different column layout for your software?{" "}
            <Link href="/finance" className="text-brand-blue-dark hover:underline">
              Ask and we'll add it.
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
