import {
  Activity,
  PoundSterling,
  Building2,
  TrendingUp,
  Layers,
} from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { BarList } from "@/components/BarList";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview } from "@/lib/clientPortal";
import { resolveRange, rangeLabel } from "./_range";
import { RangePills } from "./_components/RangePills";
import { PeriodBars } from "./_components/PeriodBars";
import { ClientHero } from "./_components/ClientHero";
import { StatCard } from "./_components/StatCard";
import { Panel } from "./_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientHome({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const me = await requireCustomer();
  const { key, from, to, bucket } = resolveRange(searchParams.range);
  const data = await loadClientOverview(me.customerId, { from, to, bucket });

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Security overview"
        title="Your sites at a glance"
        subtitle={`A live view of the security work across your sites — ${rangeLabel(
          key,
        ).toLowerCase()}.`}
      >
        <RangePills active={key} basePath="/client" dark />
      </ClientHero>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          tone="blue"
          label="Activities"
          value={formatNumber(data.totalActivities)}
          hint={rangeLabel(key).toLowerCase()}
          icon={Activity}
        />
        <StatCard
          tone="emerald"
          label="Spend"
          value={formatMoney(data.totalSpend)}
          hint="for work in this period"
          icon={PoundSterling}
        />
        <StatCard
          tone="indigo"
          label="Sites"
          value={formatNumber(data.siteCount)}
          hint="under our watch"
          icon={Building2}
        />
      </div>

      {data.activityByPeriod.length >= 2 && data.totalActivities > 0 && (
        <Panel
          title="Activity over time"
          hint="Attended work per period across your sites"
          icon={TrendingUp}
          accent="blue"
        >
          <PeriodBars
            tone="blue"
            data={data.activityByPeriod.map((p) => ({
              label: p.label,
              value: p.count,
              display: formatNumber(p.count),
            }))}
            ariaLabel="Activities per period"
          />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Activity by type" icon={Layers} accent="indigo">
          <BarList
            tone="navy"
            items={data.byKind.map((k) => ({
              label: k.label,
              value: k.count,
              display: formatNumber(k.count),
            }))}
            emptyLabel="No activity in this period."
          />
        </Panel>
        <Panel
          title="Spend by site"
          hint="Top sites in this period"
          icon={Building2}
          accent="emerald"
        >
          <BarList
            tone="blue"
            max={8}
            items={data.spendBySite.map((s) => ({
              label: s.siteName,
              value: s.amount,
              display: formatMoney(s.amount),
              href: `/client/sites/${s.siteId}?range=${key}`,
            }))}
            emptyLabel="No billed work in this period."
          />
        </Panel>
      </div>

    </div>
  );
}
