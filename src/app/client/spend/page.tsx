import { requireCustomer } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { BarList } from "@/components/BarList";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";
import { PeriodBars } from "../_components/PeriodBars";

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
    <div className="section">
      <PageHeader
        title="Spend"
        subtitle="What you've been billed for security work, by period and by site. Figures exclude VAT."
      />

      <RangePills active={key} basePath="/client/spend" />

      <div className="grid gap-3 grid-cols-3">
        <div className="card-accent p-5 flex flex-col gap-1.5">
          <div className="kpi-label">Total spend</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(data.totalSpend)}
          </div>
          <div className="kpi-hint">in this period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg / {periodWord}</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(avgPerPeriod)}
          </div>
          <div className="kpi-hint">
            across {formatNumber(periods)} {periodWord}s
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sites billed</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(sitesBilled)}
          </div>
          <div className="kpi-hint">had billed work</div>
        </div>
      </div>

      {data.spendByPeriod.length >= 2 && data.totalSpend > 0 && (
        <div className="space-y-3">
          <SectionHeading title="Spend over time" />
          <div className="card p-4 pb-3">
            <PeriodBars
              tone="blue"
              data={data.spendByPeriod.map((p) => ({
                label: p.label,
                value: p.amount,
                display: formatMoney(p.amount),
              }))}
              ariaLabel="Spend per period"
            />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <SectionHeading title="By site" hint="Highest first" />
          <div className="card p-4">
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
          </div>
        </div>
        <div className="space-y-3">
          <SectionHeading title="By period" />
          <div className="card overflow-hidden">
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
          </div>
        </div>
      </div>
    </div>
  );
}
