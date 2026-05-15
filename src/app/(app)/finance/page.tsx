import Link from "next/link";
import { prisma } from "@/lib/db";
import { recalculateBilling } from "./_actions";
import { RecalcButton } from "./_components/RecalcButton";
import { Sparkline } from "@/components/Sparkline";

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

/**
 * Parse "YYYY-MM-DD" into a local-midnight Date (or end-of-day with
 * `endOfDay=true`). Returns null for missing/invalid input — callers fall
 * back to defaults.
 */
function parseLocalDate(
  s: string | undefined,
  endOfDay = false,
): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD bucket for the sparkline densification. UTC-safe. */
function toIsoDay(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function RangePreset({
  label,
  from,
  to,
}: {
  label: string;
  from: Date;
  to: Date;
}) {
  return (
    <a
      href={`/finance?from=${ymd(from)}&to=${ymd(to)}`}
      className="chip-slate hover:bg-slate-200 cursor-pointer"
    >
      {label}
    </a>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
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

  // Date-range scope. Defaults to the current calendar month. The two
  // search params drive every KPI / P&L total below.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  monthEnd.setMilliseconds(-1); // last ms of the month

  const fromDate = parseLocalDate(searchParams.from) ?? monthStart;
  const toDate = parseLocalDate(searchParams.to, true) ?? monthEnd;

  // Comparison: same length ending the day before `fromDate`.
  const periodMs = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  // Only counts work that has actually been done. Scheduled-but-unattended
  // jobs are auto-billed by the cron at creation time, so we must anchor
  // on completion (departedAt for visits, completedAt for jobs) and
  // require the visit/job to be in a terminal state — otherwise tomorrow's
  // lock-ups would land in today's "earned" figure.
  async function billedSum(from: Date, to: Date): Promise<number> {
    const [v, j] = await prisma.$transaction([
      prisma.patrolVisit.aggregate({
        _sum: { billedAmount: true },
        where: {
          status: "COMPLETED",
          departedAt: { gte: from, lte: to },
        },
      }),
      prisma.job.aggregate({
        _sum: { billedAmount: true },
        where: {
          completedAt: { gte: from, lte: to },
        },
      }),
    ]);
    return (
      Number(v._sum.billedAmount ?? 0) + Number(j._sum.billedAmount ?? 0)
    );
  }

  // KPI: today (always anchored to "now"), the chosen range, the previous
  // range of the same length (so admin can eyeball trend).
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const [earnedToday, earnedRange, earnedPrev] = await Promise.all([
    billedSum(startOfToday, now),
    billedSum(fromDate, toDate),
    billedSum(prevFrom, prevTo),
  ]);
  const rangeDelta =
    earnedPrev > 0 ? ((earnedRange - earnedPrev) / earnedPrev) * 100 : null;

  // Daily billed series for the sparklines — last 14 calendar days,
  // anchored on the "to" end of the chosen range. Cheap raw SQL because
  // grouping JS-side over thousands of rows would round-trip too much.
  const sparkEnd = new Date(
    toDate.getFullYear(),
    toDate.getMonth(),
    toDate.getDate(),
    23,
    59,
    59,
    999,
  );
  const sparkStart = new Date(sparkEnd);
  sparkStart.setDate(sparkEnd.getDate() - 13);
  sparkStart.setHours(0, 0, 0, 0);

  const dailyRows = await prisma.$queryRaw<{ day: Date; total: number }[]>`
    SELECT day,
           COALESCE(SUM(amount), 0)::float8 AS total
    FROM (
      SELECT date_trunc('day', "departedAt") AS day, "billedAmount" AS amount
      FROM "PatrolVisit"
      WHERE "departedAt" BETWEEN ${sparkStart} AND ${sparkEnd}
        AND "status" = 'COMPLETED'
        AND "billedAmount" IS NOT NULL
      UNION ALL
      SELECT date_trunc('day', "completedAt") AS day, "billedAmount" AS amount
      FROM "Job"
      WHERE "completedAt" BETWEEN ${sparkStart} AND ${sparkEnd}
        AND "billedAmount" IS NOT NULL
    ) s
    GROUP BY day
    ORDER BY day ASC
  `;
  // Densify to 14 entries — fill gaps with 0 so the line shows real
  // quiet days, not just compressed peaks.
  const dailyMap = new Map<string, number>();
  for (const r of dailyRows) {
    dailyMap.set(toIsoDay(r.day), Number(r.total) || 0);
  }
  const dailyBilled: number[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(sparkStart);
    d.setDate(sparkStart.getDate() + i);
    dailyBilled.push(dailyMap.get(toIsoDay(d)) ?? 0);
  }

  // Per-account P&L for the current month (calendar). Billed and paid come
  // from snapshotted amounts on visits + jobs. Profit = billed − paid.
  // Visits don't have a customer/partner of their own — pull through the
  // site's relations.
  type AccountKey = string; // "customer:<id>" | "partner:<id>" | "unassigned"
  type PnlBucket = {
    key: AccountKey;
    label: string;
    billed: number;
    paid: number;
    activities: number;
  };
  const pnlByAccount = new Map<AccountKey, PnlBucket>();

  function bucketFor(
    customerId: string | null | undefined,
    customerName: string | null | undefined,
    partnerId: string | null | undefined,
    partnerName: string | null | undefined,
  ): PnlBucket {
    let key: AccountKey;
    let label: string;
    if (customerId) {
      key = `customer:${customerId}`;
      label = customerName ?? "Unknown customer";
    } else if (partnerId) {
      key = `partner:${partnerId}`;
      label = partnerName ?? "Unknown partner";
    } else {
      key = "unassigned";
      label = "Unassigned";
    }
    const existing = pnlByAccount.get(key);
    if (existing) return existing;
    const fresh: PnlBucket = { key, label, billed: 0, paid: 0, activities: 0 };
    pnlByAccount.set(key, fresh);
    return fresh;
  }

  const [rangeVisits, rangeJobs] = await Promise.all([
    prisma.patrolVisit.findMany({
      where: {
        status: "COMPLETED",
        departedAt: { gte: fromDate, lte: toDate },
      },
      select: {
        billedAmount: true,
        paidAmount: true,
        site: {
          select: {
            customerId: true,
            customer: { select: { name: true } },
            partnerId: true,
            partner: { select: { name: true } },
          },
        },
      },
    }),
    prisma.job.findMany({
      where: {
        completedAt: { gte: fromDate, lte: toDate },
      },
      select: {
        billedAmount: true,
        paidAmount: true,
        customerId: true,
        customer: { select: { name: true } },
        partnerId: true,
        partner: { select: { name: true } },
      },
    }),
  ]);
  for (const v of rangeVisits) {
    const b = bucketFor(
      v.site?.customerId ?? null,
      v.site?.customer?.name ?? null,
      v.site?.partnerId ?? null,
      v.site?.partner?.name ?? null,
    );
    b.billed += Number(v.billedAmount ?? 0);
    b.paid += Number(v.paidAmount ?? 0);
    b.activities++;
  }
  for (const j of rangeJobs) {
    const b = bucketFor(
      j.customerId,
      j.customer?.name ?? null,
      j.partnerId,
      j.partner?.name ?? null,
    );
    b.billed += Number(j.billedAmount ?? 0);
    b.paid += Number(j.paidAmount ?? 0);
    b.activities++;
  }
  const pnlRows = Array.from(pnlByAccount.values()).sort(
    (a, b) => b.billed - a.billed,
  );
  const pnlTotals = pnlRows.reduce(
    (acc, r) => ({
      billed: acc.billed + r.billed,
      paid: acc.paid + r.paid,
      activities: acc.activities + r.activities,
    }),
    { billed: 0, paid: 0, activities: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Finance</h1>
          <p className="text-sm text-slate-500">
            What we bill across all sites and customers. Per-visit and
            per-job amounts are auto-snapshotted from{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">SiteRate</code>
            . Officer pay rates and excess-time surcharge are next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/finance/payroll" className="btn-secondary text-sm">
            Payroll →
          </Link>
          <RecalcButton recalc={recalculateBilling} />
        </div>
      </div>

      <form className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={ymd(fromDate)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={ymd(toDate)}
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          <RangePreset label="Today" from={startOfToday} to={now} />
          <RangePreset
            label="Last 7 days"
            from={addDays(startOfToday, -6)}
            to={now}
          />
          <RangePreset
            label="This month"
            from={monthStart}
            to={monthEnd}
          />
          <RangePreset
            label="Last month"
            from={
              new Date(now.getFullYear(), now.getMonth() - 1, 1)
            }
            to={
              new Date(
                now.getFullYear(),
                now.getMonth(),
                0,
                23,
                59,
                59,
                999,
              )
            }
          />
        </div>
      </form>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Earned today
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmtMoney2(earnedToday)}
          </div>
          <div className="text-xs text-slate-500">
            since midnight (always anchored to now)
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                Earned in range
              </div>
              <div className="text-2xl font-semibold text-brand-navy mt-1">
                {fmtMoney2(earnedRange)}
              </div>
            </div>
            <Sparkline
              values={dailyBilled}
              ariaLabel="Daily billed for the last 14 days"
              fill="#2FCB80"
            />
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {fromDate.toLocaleDateString("en-GB")} →{" "}
            {toDate.toLocaleDateString("en-GB")} · trend: last 14 days
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Previous period
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1">
            {fmtMoney2(earnedPrev)}
          </div>
          <div
            className={
              "text-xs " +
              (rangeDelta == null
                ? "text-slate-500"
                : rangeDelta >= 0
                  ? "text-brand-mint-dark"
                  : "text-red-600")
            }
          >
            {rangeDelta == null
              ? "No prior data to compare"
              : `${rangeDelta >= 0 ? "+" : ""}${rangeDelta.toFixed(0)}% vs same-length window before`}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            P&amp;L by account
          </h2>
          <p className="text-xs text-slate-500">
            Billed minus officer pay, per customer / partner. Only counts
            visits + jobs that have been completed by the officer in the
            selected range ({fromDate.toLocaleDateString("en-GB")} →{" "}
            {toDate.toLocaleDateString("en-GB")}). Scheduled work doesn't
            count until it's done.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Account
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Activities
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Billed
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Officer pay
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Profit
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Margin
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pnlRows.map((r) => {
              const profit = r.billed - r.paid;
              const margin = r.billed > 0 ? (profit / r.billed) * 100 : 0;
              const activitiesHref = `/activities?accountId=${encodeURIComponent(r.key)}&from=${ymd(fromDate)}&to=${ymd(toDate)}`;
              return (
                <tr key={r.key}>
                  <td className="px-4 py-2 font-medium text-brand-navy">
                    {r.key === "unassigned" ? (
                      r.label
                    ) : (
                      <Link
                        href={activitiesHref}
                        className="hover:text-brand-mint-dark hover:underline"
                      >
                        {r.label}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.key === "unassigned" ? (
                      r.activities
                    ) : (
                      <Link
                        href={activitiesHref}
                        className="text-brand-navy hover:text-brand-mint-dark hover:underline"
                      >
                        {r.activities}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtMoney2(r.billed)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {fmtMoney2(r.paid)}
                  </td>
                  <td
                    className={
                      "px-4 py-2 text-right tabular-nums font-medium " +
                      (profit >= 0 ? "text-brand-navy" : "text-red-600")
                    }
                  >
                    {fmtMoney2(profit)}
                  </td>
                  <td
                    className={
                      "px-4 py-2 text-right tabular-nums text-xs " +
                      (margin >= 0 ? "text-slate-600" : "text-red-600")
                    }
                  >
                    {r.billed > 0 ? `${margin.toFixed(0)}%` : "—"}
                  </td>
                </tr>
              );
            })}
            {pnlRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Nothing billed this month yet. Use "Bill missing" above
                  after importing rates.
                </td>
              </tr>
            )}
            {pnlRows.length > 0 && (
              <tr className="bg-slate-50 font-medium">
                <td className="px-4 py-2 text-brand-navy">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {pnlTotals.activities}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtMoney2(pnlTotals.billed)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {fmtMoney2(pnlTotals.paid)}
                </td>
                <td
                  className={
                    "px-4 py-2 text-right tabular-nums " +
                    (pnlTotals.billed - pnlTotals.paid >= 0
                      ? "text-brand-navy"
                      : "text-red-600")
                  }
                >
                  {fmtMoney2(pnlTotals.billed - pnlTotals.paid)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-600">
                  {pnlTotals.billed > 0
                    ? `${(((pnlTotals.billed - pnlTotals.paid) / pnlTotals.billed) * 100).toFixed(0)}%`
                    : "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
              {groups.map((g) => {
                const owner =
                  g.sites[0]?.partnerId
                    ? `partner:${g.sites[0].partnerId}`
                    : g.sites[0]?.customerId
                      ? `customer:${g.sites[0].customerId}`
                      : null;
                const activitiesHref = owner
                  ? `/activities?accountId=${encodeURIComponent(owner)}&from=${ymd(fromDate)}&to=${ymd(toDate)}`
                  : null;
                return (
                <tr key={g.label}>
                  <td className="px-4 py-2 text-brand-navy font-medium">
                    {activitiesHref ? (
                      <Link
                        href={activitiesHref}
                        className="hover:text-brand-mint-dark hover:underline"
                      >
                        {g.label}
                      </Link>
                    ) : (
                      g.label
                    )}
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
                );
              })}
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
            Static guarding / dog handler shifts with hourly check-ins.
          </li>
          <li>
            Monthly payroll export (CSV) — sums OfficerRate monthly retainers
            plus all per-activity pay.
          </li>
          <li>
            Date-range picker on this page to scope KPIs and the P&amp;L table.
          </li>
        </ul>
      </div>
    </div>
  );
}
