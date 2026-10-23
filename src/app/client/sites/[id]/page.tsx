import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, PoundSterling, TrendingUp, ClipboardList, Clock } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatHours, formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview, loadClientActivities } from "@/lib/clientPortal";
import { periodHref, resolvePeriod, type PeriodSearch } from "@/lib/clientPeriod";
import { PeriodControl } from "../../_components/PeriodControl";
import { TypeBars } from "../../_components/TypeBars";
import { typeChart } from "../../_components/typeChart";
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
  searchParams: PeriodSearch;
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

  const period = resolvePeriod(searchParams);
  const { from, to, bucket } = period;
  const p = period.params;
  const [overview, activities] = await Promise.all([
    loadClientOverview(me.customerId, { from, to, bucket, siteId: site.id }),
    loadClientActivities(me.customerId, { from, to, siteId: site.id, limit: 200 }),
  ]);
  const guarding = overview.byGroup.find((g) => g.group === "guarding")!;
  const chart = typeChart(overview.byPeriod, period, { siteId: site.id });
  const logHref = periodHref("/client/activities", p, { siteId: site.id });

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow={site.code ? `Site ${site.code}` : "Site"}
        title={site.name}
        backHref={periodHref("/client/sites", p)}
        backLabel="Your sites"
        subtitle={
          <>
            {site.addressLine}
            {site.city ? `, ${site.city}` : ""} · {site.postcodeFormatted}
            {site.region ? ` · ${site.region.name}` : ""}
          </>
        }
      >
        <PeriodControl basePath={`/client/sites/${site.id}`} period={period} />
      </ClientHero>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          tone="blue"
          label="Activities"
          value={formatNumber(overview.totalActivities)}
          hint={period.label}
          icon={Activity}
          href={logHref}
        />
        <StatCard
          tone="amber"
          label="Static guarding"
          value={formatHours(overview.guardingHours)}
          hint={`${formatNumber(guarding.count)} ${guarding.count === 1 ? "shift" : "shifts"}`}
          icon={Clock}
          href={periodHref("/client/activities", p, { siteId: site.id, type: "guarding" })}
        />
        <StatCard
          tone="emerald"
          label="Charged"
          value={formatMoney(overview.totalSpend)}
          hint="ex VAT, for work at this site"
          icon={PoundSterling}
          href={logHref}
        />
      </div>

      {chart.columns.length >= 2 && overview.totalActivities > 0 && (
        <Panel
          title="Activity over time"
          hint="Click a colour to see that work"
          icon={TrendingUp}
          accent="blue"
        >
          <TypeBars {...chart} label={`Activities per ${bucket} at this site, by type`} />
        </Panel>
      )}

      <Panel
        title="Activity log"
        hint={
          activities.length < overview.totalActivities
            ? `Latest ${formatNumber(activities.length)} of ${formatNumber(overview.totalActivities)}`
            : undefined
        }
        icon={ClipboardList}
        accent="indigo"
        flush
        action={
          <Link href={logHref} className="text-sm font-medium text-brand-blue-dark hover:underline">
            Open in activity log
          </Link>
        }
      >
        <ActivityList activities={activities} showSite={false} />
      </Panel>
    </div>
  );
}
