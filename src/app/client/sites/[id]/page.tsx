import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { InteractiveTrend } from "@/components/InteractiveTrend";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview, loadClientActivities } from "@/lib/clientPortal";
import { resolveRange } from "../../_range";
import { RangePills } from "../../_components/RangePills";
import { ActivityList } from "../../_components/ActivityList";

export const dynamic = "force-dynamic";

export default async function ClientSiteDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { days?: string };
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

  const { days, from, to } = resolveRange(searchParams.days);
  const [overview, activities] = await Promise.all([
    loadClientOverview(me.customerId, { from, to, siteId: site.id }),
    loadClientActivities(me.customerId, { from, to, siteId: site.id, limit: 200 }),
  ]);

  const topKind = overview.byKind[0] ?? null;

  return (
    <div className="section">
      <PageHeader
        title={site.name}
        backHref={`/client/sites?days=${days}`}
        backLabel="Your sites"
        subtitle={
          <>
            {site.code ? `${site.code} · ` : ""}
            {site.addressLine}
            {site.city ? `, ${site.city}` : ""} · {site.postcodeFormatted}
            {site.region ? ` · ${site.region.name}` : ""}
          </>
        }
      />

      <RangePills days={days} basePath={`/client/sites/${site.id}`} />

      <div className="grid gap-3 grid-cols-3">
        <div className="kpi">
          <div className="kpi-label">Activities</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(overview.totalActivities)}
          </div>
          <div className="kpi-hint">in this period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Spend</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(overview.totalSpend)}
          </div>
          <div className="kpi-hint">for work at this site</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Most frequent</div>
          <div className="kpi-value text-brand-navy">
            {topKind ? formatNumber(topKind.count) : "—"}
          </div>
          <div className="kpi-hint">{topKind?.label ?? "no activity yet"}</div>
        </div>
      </div>

      {overview.activityByMonth.length >= 2 && (
        <div className="space-y-3">
          <SectionHeading title="Activity over time" />
          <div className="card p-4">
            <InteractiveTrend
              values={overview.activityByMonth.map((m) => m.count)}
              labels={overview.activityByMonth.map((m) => m.label)}
              displayValues={overview.activityByMonth.map((m) =>
                formatNumber(m.count),
              )}
              ariaLabel="Activities per month at this site"
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <SectionHeading title="Activity log" />
        <div className="card overflow-hidden">
          <ActivityList activities={activities} showSite={false} />
        </div>
      </div>
    </div>
  );
}
