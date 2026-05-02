import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const RATE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  KEYHOLDING: "Keyholding",
  LOCKUP: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  PATROL: "Patrol",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
  ADHOC: "Ad-hoc",
  ANNUAL_SUBSCRIPTION: "Annual subscription",
  SITE_SETUP: "Site setup",
};

function fmtMoney(amount: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtMoney2(amount: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export default async function FinancePage() {
  // Pull every site that has at least one rate row, plus its rates and the
  // partner/customer it belongs to. Stays in JS for the aggregations because
  // the per-row work is small (handful of customers/partners).
  const sites = await prisma.site.findMany({
    where: { active: true, rates: { some: {} } },
    include: {
      rates: true,
      partner: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  type Group = {
    label: string;
    sites: typeof sites;
    annual: number;
    setup: number;
  };
  const byPartnerOrCustomer = new Map<string, Group>();
  let totalAnnual = 0;
  let totalSetup = 0;
  let totalRateRows = 0;

  for (const s of sites) {
    const owner =
      s.partner?.name ?? s.customer?.name ?? "Unassigned";
    const ownerKey = owner;
    const annualRate = s.rates.find((r) => r.service === "ANNUAL_SUBSCRIPTION");
    const setupRate = s.rates.find((r) => r.service === "SITE_SETUP");
    const annual = annualRate ? Number(annualRate.amount) : 0;
    const setup = setupRate ? Number(setupRate.amount) : 0;
    totalAnnual += annual;
    totalSetup += setup;
    totalRateRows += s.rates.length;

    const g = byPartnerOrCustomer.get(ownerKey) ?? {
      label: owner,
      sites: [] as typeof sites,
      annual: 0,
      setup: 0,
    };
    g.sites.push(s);
    g.annual += annual;
    g.setup += setup;
    byPartnerOrCustomer.set(ownerKey, g);
  }

  const groups = Array.from(byPartnerOrCustomer.values()).sort(
    (a, b) => b.annual - a.annual,
  );

  const topSitesByAnnual = sites
    .map((s) => {
      const a = s.rates.find((r) => r.service === "ANNUAL_SUBSCRIPTION");
      return { site: s, annual: a ? Number(a.amount) : 0 };
    })
    .filter((s) => s.annual > 0)
    .sort((a, b) => b.annual - a.annual)
    .slice(0, 10);

  const sitesMissingRates = await prisma.site.count({
    where: { active: true, rates: { none: {} } },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Finance</h1>
        <p className="text-sm text-slate-500">
          What we bill across all sites and customers. Pulled from{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">SiteRate</code>{" "}
          rows. Auto-calculated job billing and officer pay are coming next.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Total annual subscriptions
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmtMoney(totalAnnual)}
          </div>
          <div className="text-xs text-slate-500">across all sites · per year</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Total setup fees
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmtMoney(totalSetup)}
          </div>
          <div className="text-xs text-slate-500">one-off</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Sites with rates
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1 tabular-nums">
            {sites.length.toLocaleString("en-GB")}
          </div>
          <div className="text-xs text-slate-500">{totalRateRows} rate rows</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Sites missing rates
          </div>
          <div
            className={`text-2xl font-semibold tabular-nums mt-1 ${
              sitesMissingRates > 0 ? "text-amber-600" : "text-brand-navy"
            }`}
          >
            {sitesMissingRates.toLocaleString("en-GB")}
          </div>
          <div className="text-xs text-slate-500">need import or manual entry</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">By customer / partner</h2>
            <p className="text-xs text-slate-500">
              Annual subscription value rolled up to the company that pays.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Account
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Sites
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Annual
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Setup
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <tr key={g.label}>
                  <td className="px-4 py-2 text-brand-navy font-medium">
                    {g.label}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {g.sites.length}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                    {fmtMoney(g.annual)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {g.setup > 0 ? fmtMoney(g.setup) : "—"}
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No financial data yet. Run the Nexus importer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Top sites by annual</h2>
            <p className="text-xs text-slate-500">Highest annual subscription.</p>
          </div>
          {topSitesByAnnual.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">
              No annual subscriptions set yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Site
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Account
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Annual
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topSitesByAnnual.map((row) => (
                  <tr key={row.site.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/sites/${row.site.id}?tab=finance`}
                        className="text-brand-navy hover:text-brand-mint-dark font-medium"
                      >
                        {row.site.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {row.site.partnerReference ??
                          row.site.code ??
                          row.site.postcodeFormatted}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {row.site.partner?.name ??
                        row.site.customer?.name ??
                        "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                      {fmtMoney2(row.annual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card p-4 bg-slate-50">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
          Coming next
        </h3>
        <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
          <li>
            Auto-billed jobs — Job.billedAmount fills from the matching SiteRate
            when a job is created.
          </li>
          <li>
            Officer pay rates — per officer per service, summed monthly into pay
            statements.
          </li>
          <li>
            Per-account P&amp;L — billed minus pay, per customer/partner, with
            month-by-month export.
          </li>
        </ul>
      </div>
    </div>
  );
}
