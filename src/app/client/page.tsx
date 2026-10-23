import Link from "next/link";
import {
  Activity,
  PoundSterling,
  Building2,
  TrendingUp,
  Layers,
  Clock,
} from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { BarList } from "@/components/BarList";
import { formatHours, formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview } from "@/lib/clientPortal";
import { periodHref, resolvePeriod, type PeriodSearch } from "@/lib/clientPeriod";
import { PeriodControl } from "./_components/PeriodControl";
import { TypeBars } from "./_components/TypeBars";
import { TypeTable } from "./_components/TypeTable";
import { typeChart } from "./_components/typeChart";
import { ClientHero } from "./_components/ClientHero";
import { StatCard } from "./_components/StatCard";
import { Panel } from "./_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientHome({ searchParams }: { searchParams: PeriodSearch }) {
  const me = await requireCustomer();
  const period = resolvePeriod(searchParams);
  const data = await loadClientOverview(me.customerId, {
    from: period.from,
    to: period.to,
    bucket: period.bucket,
  });
  const p = period.params;
  const guarding = data.byGroup.find((g) => g.group === "guarding")!;
  const chart = typeChart(data.byPeriod, period);

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Security overview"
        title="Your sites at a glance"
        subtitle={`A live view of the security work across your sites — ${period.label}.`}
      >
        <PeriodControl basePath="/client" period={period} />
      </ClientHero>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          tone="blue"
          label="Activities"
          value={formatNumber(data.totalActivities)}
          hint={period.label}
          icon={Activity}
          href={periodHref("/client/activities", p)}
        />
        <StatCard
          tone="amber"
          label="Static guarding"
          value={formatHours(data.guardingHours)}
          hint={`${formatNumber(guarding.count)} ${guarding.count === 1 ? "shift" : "shifts"}`}
          icon={Clock}
          href={periodHref("/client/activities", p, { type: "guarding" })}
        />
        <StatCard
          tone="emerald"
          label="Charged"
          value={formatMoney(data.totalSpend)}
          hint="ex VAT, for this work"
          icon={PoundSterling}
          href={periodHref("/client/spend", p)}
        />
        <StatCard
          tone="indigo"
          label="Sites"
          value={formatNumber(data.siteCount)}
          hint="under our watch"
          icon={Building2}
          href={periodHref("/client/sites", p)}
        />
      </div>

      {chart.columns.length >= 2 && data.totalActivities > 0 && (
        <Panel
          title="Activity over time"
          hint="Click a colour to see that work"
          icon={TrendingUp}
          accent="blue"
        >
          <TypeBars {...chart} label={`Activities per ${period.bucket}, by type`} />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Activity by type"
          hint="Static guarding in hours"
          icon={Layers}
          accent="indigo"
          flush
        >
          <TypeTable
            groups={data.byGroup}
            hrefFor={(g) => periodHref("/client/activities", p, { type: g })}
          />
        </Panel>
        <Panel
          title="Charges by site"
          hint="Top sites in this period"
          icon={Building2}
          accent="emerald"
          action={
            <Link
              href={periodHref("/client/sites", p)}
              className="text-sm font-medium text-brand-blue-dark hover:underline"
            >
              All sites
            </Link>
          }
        >
          <BarList
            tone="blue"
            items={data.spendBySite
              .filter((s) => s.amount > 0)
              .slice(0, 8)
              .map((s) => ({
              label: s.siteName,
              value: s.amount,
              display: formatMoney(s.amount),
              href: periodHref(`/client/sites/${s.siteId}`, p),
            }))}
            emptyLabel="Nothing charged in this period."
          />
        </Panel>
      </div>
    </div>
  );
}
