import { PoundSterling, CalendarDays, Building2, TrendingUp } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { BarList } from "@/components/BarList";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";
import { PeriodBars } from "../_components/PeriodBars";
import { ClientHero } from "../_components/ClientHero";
import { StatCard } from "../_components/StatCard";
import { Panel } from "../_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientSpendPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const me = await requireCustomer();
  const { key, from, to, bucket } = resolveRange(searchParams.range);
  const data = await loadClientOverview(me.customerId, { from, to, bucket });

  const periods = data.spendByPeriod.length || 1;
  const avgPerPeriod = data.totalSpend / periods;
  const sitesBilled = data.spendBySite.filter((s) => s.amount > 0).length;
  const periodWord =
    bucket === "month" ? "month" : bucket === "week" ? "week" : "day";

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Spend"
        title="What you've been billed"
        subtitle="Security work billed to your account, by period and by site. Figures exclude VAT."
      >
        <RangePills active={key} basePath="/client/spend" dark />
      </ClientHero>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          tone="emerald"
          label="Total spend"
          value={formatMoney(data.totalSpend)}
          hint="in this period"
          icon={PoundSterling}
        />
        <StatCard
          tone="blue"
          label={`Avg / ${periodWord}`}
          value={formatMoney(avgPerPeriod)}
          hint={`across ${formatNumber(periods)} ${periodWord}s`}
          icon={CalendarDays}
        />
        <StatCard
          tone="indigo"
          label="Sites billed"
          value={formatNumber(sitesBilled)}
          hint="had billed work"
          icon={Building2}
        />
      </div>

      {data.spendByPeriod.length >= 2 && data.totalSpend > 0 && (
        <Panel title="Spend over time" icon={TrendingUp} accent="emerald">
          <PeriodBars
            tone="emerald"
            data={data.spendByPeriod.map((p) => ({
              label: p.label,
              value: p.amount,
              display: formatMoney(p.amount),
            }))}
            ariaLabel="Spend per period"
          />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By site" hint="Highest first" icon={Building2} accent="blue">
          <BarList
            tone="blue"
            items={data.spendBySite.map((s) => ({
              label: s.siteName,
              value: s.amount,
              display: formatMoney(s.amount),
              href: `/client/sites/${s.siteId}?range=${key}`,
            }))}
            emptyLabel="No billed work in this period."
          />
        </Panel>
        <Panel title="By period" icon={CalendarDays} accent="indigo" flush>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="col-num">Spend</th>
                </tr>
              </thead>
              <tbody>
                {data.spendByPeriod.map((p) => (
                  <tr key={p.key}>
                    <td className="text-slate-700">{p.label}</td>
                    <td className="col-num tabular-nums text-slate-700">
                      {formatMoney(p.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="text-brand-navy">Total</td>
                  <td className="col-num tabular-nums text-brand-navy">
                    {formatMoney(data.totalSpend)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
