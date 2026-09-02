import { requireCustomer } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { BarList } from "@/components/BarList";
import { InteractiveTrend } from "@/components/InteractiveTrend";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { loadClientOverview } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";

export const dynamic = "force-dynamic";

export default async function ClientSpendPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const me = await requireCustomer();
  const { days, from, to } = resolveRange(searchParams.days);
  const data = await loadClientOverview(me.customerId, { from, to });

  const months = data.spendByMonth.length || 1;
  const avgPerMonth = data.totalSpend / months;
  const sitesBilled = data.spendBySite.filter((s) => s.amount > 0).length;

  return (
    <div className="section">
      <PageHeader
        title="Spend"
        subtitle="What you've been billed for security work, by month and by site. Figures exclude VAT."
      />

      <RangePills days={days} basePath="/client/spend" />

      <div className="grid gap-3 grid-cols-3">
        <div className="card-accent p-5 flex flex-col gap-1.5">
          <div className="kpi-label">Total spend</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(data.totalSpend)}
          </div>
          <div className="kpi-hint">in this period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg / month</div>
          <div className="kpi-value text-brand-navy">
            {formatMoney(avgPerMonth)}
          </div>
          <div className="kpi-hint">across {formatNumber(months)} months</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sites billed</div>
          <div className="kpi-value text-brand-navy">
            {formatNumber(sitesBilled)}
          </div>
          <div className="kpi-hint">had billed work</div>
        </div>
      </div>

      {data.spendByMonth.length >= 2 && (
        <div className="space-y-3">
          <SectionHeading title="Spend over time" />
          <div className="card p-4">
            <InteractiveTrend
              values={data.spendByMonth.map((m) => m.amount)}
              labels={data.spendByMonth.map((m) => m.label)}
              displayValues={data.spendByMonth.map((m) => formatMoney(m.amount))}
              ariaLabel="Spend per month"
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
                href: `/client/sites/${s.siteId}?days=${days}`,
              }))}
              emptyLabel="No billed work in this period."
            />
          </div>
        </div>
        <div className="space-y-3">
          <SectionHeading title="By month" />
          <div className="card overflow-hidden">
            <div className="table-scroll">
              <table className="table-default">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="col-num">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.spendByMonth.map((m) => (
                    <tr key={m.key}>
                      <td className="text-slate-700">{m.label}</td>
                      <td className="col-num tabular-nums text-slate-700">
                        {formatMoney(m.amount)}
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
