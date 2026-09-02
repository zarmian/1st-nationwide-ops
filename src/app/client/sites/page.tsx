import Link from "next/link";
import { Building2, CheckCircle2, PoundSterling } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import { loadClientSites } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";
import { ClientHero } from "../_components/ClientHero";
import { StatCard } from "../_components/StatCard";
import { Panel } from "../_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientSitesPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const me = await requireCustomer();
  const { key, from, to } = resolveRange(searchParams.range);
  const sites = await loadClientSites(me.customerId, { from, to });

  const withActivity = sites.filter((s) => s.activityCount > 0).length;
  const totalSpend = sites.reduce((sum, s) => sum + s.spend, 0);

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Your sites"
        title="Sites we cover for you"
        subtitle="Every site under our watch, with activity and spend in the selected period."
      >
        <RangePills active={key} basePath="/client/sites" dark />
      </ClientHero>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          tone="indigo"
          label="Sites"
          value={formatNumber(sites.length)}
          hint="under our watch"
          icon={Building2}
        />
        <StatCard
          tone="blue"
          label="Active this period"
          value={formatNumber(withActivity)}
          hint="had recorded activity"
          icon={CheckCircle2}
        />
        <StatCard
          tone="emerald"
          label="Spend"
          value={formatMoney(totalSpend)}
          hint="across all sites"
          icon={PoundSterling}
        />
      </div>

      <Panel title="All sites" icon={Building2} accent="indigo" flush>
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
                      href={`/client/sites/${s.id}?range=${key}`}
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
      </Panel>
    </div>
  );
}
