import Link from "next/link";
import { requireCustomer } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { BarList } from "@/components/BarList";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview } from "@/lib/clientPortal";
import { resolveRange, rangeLabel } from "./_range";
import { RangePills } from "./_components/RangePills";
import { PeriodBars } from "./_components/PeriodBars";
import { ActivityList } from "./_components/ActivityList";

export const dynamic = "force-dynamic";

export default async function ClientHome({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const me = await requireCustomer();
  const { key, from, to, bucket } = resolveRange(searchParams.range);
  const data = await loadClientOverview(me.customerId, { from, to, bucket });

  const topKind = data.byKind[0] ?? null;

  return (
    <div className="section">
      <PageHeader
        title="Overview"
        subtitle="A live view of the security work across your sites."
      />

      <RangePills active={key} basePath="/client" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="card-accent p-5 flex flex-col gap-1.5">
          <div className="kpi-label">Activities</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(data.totalActivities)}
          </div>
          <div className="kpi-hint">{rangeLabel(key).toLowerCase()}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Spend</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(data.totalSpend)}
          </div>
          <div className="kpi-hint">for work in this period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sites</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(data.siteCount)}
          </div>
          <div className="kpi-hint">under our watch</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Most frequent</div>
          <div className="kpi-value text-brand-navy">
            {topKind ? formatNumber(topKind.count) : "—"}
          </div>
          <div className="kpi-hint">{topKind?.label ?? "no activity yet"}</div>
        </div>
      </div>

      {data.activityByPeriod.length >= 2 && data.totalActivities > 0 && (
        <div className="space-y-3">
          <SectionHeading
            title="Activity over time"
            hint="Attended work per period across your sites"
          />
          <div className="card p-4 pb-3">
            <PeriodBars
              tone="navy"
              data={data.activityByPeriod.map((p) => ({
                label: p.label,
                value: p.count,
                display: formatNumber(p.count),
              }))}
              ariaLabel="Activities per period"
            />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <SectionHeading title="Activity by type" />
          <div className="card p-4">
            <BarList
              tone="navy"
              items={data.byKind.map((k) => ({
                label: k.label,
                value: k.count,
                display: formatNumber(k.count),
              }))}
              emptyLabel="No activity in this period."
            />
          </div>
        </div>
        <div className="space-y-3">
          <SectionHeading title="Spend by site" hint="Top sites in this period" />
          <div className="card p-4">
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
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeading title="Recent activity" />
          <Link
            href={`/client/activities?range=${key}`}
            className="text-sm text-brand-blue-dark hover:underline shrink-0"
          >
            View all →
          </Link>
        </div>
        <div className="card overflow-hidden">
          <ActivityList activities={data.recent} />
        </div>
      </div>
    </div>
  );
}
