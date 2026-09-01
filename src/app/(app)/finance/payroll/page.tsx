import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { buildPayrollReport } from "@/lib/payroll";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDate(
  s: string | undefined,
  endOfDay = false,
): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const fromDate = parseLocalDate(searchParams.from) ?? monthStart;
  const toDate = parseLocalDate(searchParams.to, true) ?? monthEnd;

  const report = await buildPayrollReport(fromDate, toDate);

  const exportHref = `/api/payroll/export?from=${ymd(fromDate)}&to=${ymd(toDate)}`;

  return (
    <div className="section">
      <PageHeader
        title="Payroll"
        backHref="/finance"
        backLabel="Finance"
        subtitle={
          <>
            Monthly retainer (from each officer's <code>per month</code>{" "}
            OfficerRate row) plus the sum of paid activity snapshots in
            the period. One row per active officer / dispatcher.
          </>
        }
        actions={
          <a href={exportHref} className="btn-primary text-sm" download>
            Download CSV
          </a>
        }
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
            defaultValue={ymd(fromDate)}
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
            defaultValue={ymd(toDate)}
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
      </form>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Total retainer
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmt(report.totals.retainer, "GBP")}
          </div>
          <div className="text-xs text-slate-500">
            {report.rows[0]?.retainerMonths ?? 0} month
            {(report.rows[0]?.retainerMonths ?? 0) === 1 ? "" : "s"} ×
            officers with a retainer rate
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Total activity pay
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmt(report.totals.activityPay, "GBP")}
          </div>
          <div className="text-xs text-slate-500">
            from paid snapshots on visits + jobs
          </div>
        </div>
        <div className="card p-4 bg-brand-blue-light/50">
          <div className="text-xs uppercase tracking-wider text-brand-blue-dark">
            Grand total
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmt(report.totals.grand, "GBP")}
          </div>
          <div className="text-xs text-slate-500">
            {report.rows.length} officer{report.rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="table-scroll">
        <table className="table-default">
          <thead>
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Officer
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                SIA
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Retainer
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Activity pay
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Activities
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Adjustments
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Total
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.officerId}>
                <td className="px-4 py-2">
                  <Link
                    href={`/officers/${r.officerId}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {r.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {r.role.toLowerCase()}
                  </div>
                </td>
                <td className="px-4 py-2 text-slate-600 font-mono text-xs">
                  {r.siaNumber ?? "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {fmt(r.retainerAmount, r.currency)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {fmt(r.activityPay, r.currency)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                  {r.activityCount}
                </td>
                <td
                  className={
                    "px-4 py-2 text-right tabular-nums " +
                    (r.adjustments < 0
                      ? "text-red-600"
                      : r.adjustments > 0
                        ? "text-slate-700"
                        : "text-slate-400")
                  }
                >
                  {r.adjustments === 0 ? "—" : fmt(r.adjustments, r.currency)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                  {fmt(r.total, r.currency)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/finance/officers/${r.officerId}/payslip?from=${ymd(fromDate)}&to=${ymd(toDate)}`}
                    className="text-brand-blue-dark hover:underline text-sm whitespace-nowrap"
                  >
                    Payslip →
                  </Link>
                </td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No active officers — add one at{" "}
                  <Link href="/officers" className="text-brand-blue-dark hover:underline">
                    /officers
                  </Link>
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
