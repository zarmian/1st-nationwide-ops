import Link from "next/link";
import { requireCustomer } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import { loadClientSites } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";

export const dynamic = "force-dynamic";

export default async function ClientSitesPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const me = await requireCustomer();
  const { days, from, to } = resolveRange(searchParams.days);
  const sites = await loadClientSites(me.customerId, { from, to });

  const withActivity = sites.filter((s) => s.activityCount > 0).length;

  return (
    <div className="section">
      <PageHeader
        title="Your sites"
        subtitle="Every site we cover for you, with activity and spend in the selected period."
      />

      <RangePills days={days} basePath="/client/sites" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <div className="kpi">
          <div className="kpi-label">Sites</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(sites.length)}
          </div>
          <div className="kpi-hint">under our watch</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Active this period</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(withActivity)}
          </div>
          <div className="kpi-hint">had recorded activity</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Spend</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(sites.reduce((sum, s) => sum + s.spend, 0))}
          </div>
          <div className="kpi-hint">across all sites</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Site</th>
                <th>Region</th>
                <th className="col-num">Activities</th>
                <th className="col-num">Spend</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link
                      href={`/client/sites/${s.id}?days=${days}`}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {s.code ? `${s.code} · ` : ""}
                      {s.name}
                    </Link>
                  </td>
                  <td className="text-slate-600">{s.regionName ?? "—"}</td>
                  <td className="col-num tabular-nums text-slate-700">
                    {s.activityCount > 0 ? formatNumber(s.activityCount) : "—"}
                  </td>
                  <td className="col-num tabular-nums text-slate-700">
                    {s.spend > 0 ? formatMoney(s.spend) : "—"}
                  </td>
                  <td className="whitespace-nowrap text-slate-600">
                    {s.lastActivityAt ? formatDate(s.lastActivityAt) : "—"}
                  </td>
                </tr>
              ))}
              {sites.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No sites on your account yet.
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
