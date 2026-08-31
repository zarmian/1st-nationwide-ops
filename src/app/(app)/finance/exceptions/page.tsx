import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, parseIsoDate, toIsoDate } from "@/lib/dates";
import { loadBillingExceptions } from "@/lib/financeExceptions";

export const dynamic = "force-dynamic";

/**
 * Billing / pay exceptions — completed work that never got priced. Set the
 * missing rate on the site (or customer default), then Recompute on /finance.
 */
export default async function FinanceExceptionsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  const from =
    parseIsoDate(searchParams.from) ??
    new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseIsoDate(searchParams.to, true) ?? now;

  const { rows, counts, capped } = await loadBillingExceptions(from, to);

  return (
    <div className="section">
      <PageHeader
        title="Billing exceptions"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Completed work that isn't priced yet — set the missing rate, then Recompute on Finance to fold it into P&L and payroll."
      />

      <form className="card p-4 flex flex-wrap items-end gap-3">
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
      </form>

      <div className="grid grid-cols-2 gap-3">
        <div className="kpi">
          <div className="kpi-label">Not billed</div>
          <div className="kpi-value">{counts.needsBill}</div>
          <div className="kpi-hint">completed, no customer charge</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Officer unpaid</div>
          <div className="kpi-value">{counts.needsPay}</div>
          <div className="kpi-hint">we attended, no pay recorded</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Nothing to fix here 🎉</p>
          <p className="empty-blurb">
            Every completed activity in this range is billed and paid.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Site</th>
                  <th>Account</th>
                  <th>Officer</th>
                  <th>Issue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}:${r.id}`}>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(r.date)}
                    </td>
                    <td className="whitespace-nowrap">{r.typeLabel}</td>
                    <td>
                      {r.siteId ? (
                        <Link
                          href={`/sites/${r.siteId}`}
                          className="text-brand-blue-dark hover:underline"
                        >
                          {r.siteName}
                        </Link>
                      ) : (
                        r.siteName
                      )}
                    </td>
                    <td>{r.account ?? "—"}</td>
                    <td>{r.officer ?? "—"}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      {r.needsBill && (
                        <span className="chip-amber text-[10px]">No bill</span>
                      )}
                      {r.needsPay && (
                        <span className="chip-red text-[10px]">No pay</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {capped && (
        <p className="text-xs text-slate-500">
          Showing the first 1,000 of each type — narrow the date range to see
          the rest.
        </p>
      )}
      <p className="text-xs text-slate-500">
        To fix: open the site and set the missing rate on its Finance tab (or
        the customer default), then use{" "}
        <Link href="/finance" className="text-brand-blue-dark hover:underline">
          Recompute
        </Link>{" "}
        on Finance for this date range. “No pay” usually means a missing officer
        rate on{" "}
        <Link
          href="/admin/officer-rates"
          className="text-brand-blue-dark hover:underline"
        >
          officer rates
        </Link>
        .
      </p>
    </div>
  );
}
