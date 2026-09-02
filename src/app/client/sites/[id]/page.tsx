import { notFound } from "next/navigation";
import { Activity, PoundSterling, BarChart3, TrendingUp, ClipboardList } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview, loadClientActivities } from "@/lib/clientPortal";
import { resolveRange } from "../../_range";
import { RangePills } from "../../_components/RangePills";
import { PeriodBars } from "../../_components/PeriodBars";
import { ActivityList } from "../../_components/ActivityList";
import { ClientHero } from "../../_components/ClientHero";
import { StatCard } from "../../_components/StatCard";
import { Panel } from "../../_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientSiteDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { range?: string };
}) {
  const me = await requireCustomer();

  // Scope enforcement: the site must belong to THIS customer, or it's a 404.
  // Never trust the URL id for access.
  const site = await prisma.site.findFirst({
    where: { id: params.id, customerId: me.customerId },
    select: {
      id: true,
      name: true,
      code: true,
      addressLine: true,
      city: true,
      postcodeFormatted: true,
      region: { select: { name: true } },
    },
  });
  if (!site) notFound();

  const { key, from, to, bucket } = resolveRange(searchParams.range);
  const [overview, activities] = await Promise.all([
    loadClientOverview(me.customerId, { from, to, bucket, siteId: site.id }),
    loadClientActivities(me.customerId, { from, to, siteId: site.id, limit: 200 }),
  ]);

  const topKind = overview.byKind[0] ?? null;

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow={site.code ? `Site ${site.code}` : "Site"}
        title={site.name}
        backHref={`/client/sites?range=${key}`}
        backLabel="Your sites"
        subtitle={
          <>
            {site.addressLine}
            {site.city ? `, ${site.city}` : ""} · {site.postcodeFormatted}
            {site.region ? ` · ${site.region.name}` : ""}
          </>
        }
      >
        <RangePills active={key} basePath={`/client/sites/${site.id}`} dark />
      </ClientHero>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          tone="blue"
          label="Activities"
          value={formatNumber(overview.totalActivities)}
          hint="in this period"
          icon={Activity}
        />
        <StatCard
          tone="emerald"
          label="Spend"
          value={formatMoney(overview.totalSpend)}
          hint="for work at this site"
          icon={PoundSterling}
        />
        <StatCard
          tone="amber"
          label="Most frequent"
          value={topKind ? formatNumber(topKind.count) : "—"}
          hint={topKind?.label ?? "no activity yet"}
          icon={BarChart3}
        />
      </div>

      {overview.activityByPeriod.length >= 2 && overview.totalActivities > 0 && (
        <Panel title="Activity over time" icon={TrendingUp} accent="blue">
          <PeriodBars
            tone="blue"
            data={overview.activityByPeriod.map((p) => ({
              label: p.label,
              value: p.count,
              display: formatNumber(p.count),
            }))}
            ariaLabel="Activities per period at this site"
          />
        </Panel>
      )}

      <Panel title="Activity log" icon={ClipboardList} accent="indigo" flush>
        <ActivityList activities={activities} showSite={false} />
      </Panel>
    </div>
  );
}
