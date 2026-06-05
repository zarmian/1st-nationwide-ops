import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
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
  // Admin-only. Middleware enforces the redirect; this is the backstop
  // in case middleware is bypassed (server actions imported directly,
  // etc.) so the page won't render the totals to a non-admin session.
  await requireAdmin();

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
          status: { not: "CANCELLED" },
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
        AND "status" <> 'CANCELLED'
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
        officerId: true,
        officer: { select: { name: true } },
        siteId: true,
        site: {
          select: {
            id: true,
            name: true,
            code: true,
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
        status: { not: "CANCELLED" },
      },
      select: {
        billedAmount: true,
        paidAmount: true,
        siteId: true,
        site: {
          select: { name: true, code: true },
        },
        customerId: true,
        customer: { select: { name: true } },
        partnerId: true,
        partner: { select: { name: true } },
        assignedToUserId: true,
        assignedTo: { select: { name: true } },
        handledByPartnerId: true,
        handledByPartner: { select: { name: true } },
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

  // Officer P&L: per-officer cost (what we paid) + activity count. Used by
  // the dashboard's Officers section and as the click-through target. Same
  // date scope as customers.
  type OfficerBucket = {
    id: string;
    name: string;
    activities: number;
    paid: number;
  };
  const officerByKey = new Map<string, OfficerBucket>();
  function officerBucket(
    id: string | null | undefined,
    name: string | null | undefined,
  ): OfficerBucket | null {
    if (!id) return null;
    const existing = officerByKey.get(id);
    if (existing) return existing;
    const fresh: OfficerBucket = {
      id,
      name: name ?? "Unknown officer",
      activities: 0,
      paid: 0,
    };
    officerByKey.set(id, fresh);
    return fresh;
  }
  for (const v of rangeVisits) {
    const o = officerBucket(v.officerId, v.officer?.name);
    if (!o) continue;
    o.activities++;
    o.paid += Number(v.paidAmount ?? 0);
  }
  for (const j of rangeJobs) {
    const o = officerBucket(j.assignedToUserId, j.assignedTo?.name);
    if (!o) continue;
    o.activities++;
    o.paid += Number(j.paidAmount ?? 0);
  }
  const officerRows = Array.from(officerByKey.values()).sort(
    (a, b) => b.paid - a.paid,
  );

  // Partner P&L: per-partner split between
  //   asCustomer       = jobs/visits where the partner is the bill-to
  //                      account (Job.partnerId or Site.partnerId via
  //                      visits). billedAmount is our revenue from them.
  //   asSubcontractor  = jobs where they handled the work for us
  //                      (Job.handledByPartnerId). billedAmount on these
  //                      is what we charged the end customer; the schema
  //                      doesn't yet track what we owe them in return.
  type PartnerSide = { activities: number; billed: number };
  type PartnerBucket = {
    id: string;
    name: string;
    asCustomer: PartnerSide;
    asSubcontractor: PartnerSide;
  };
  const partnerByKey = new Map<string, PartnerBucket>();
  function partnerBucket(
    id: string | null | undefined,
    name: string | null | undefined,
  ): PartnerBucket | null {
    if (!id) return null;
    const existing = partnerByKey.get(id);
    if (existing) return existing;
    const fresh: PartnerBucket = {
      id,
      name: name ?? "Unknown partner",
      asCustomer: { activities: 0, billed: 0 },
      asSubcontractor: { activities: 0, billed: 0 },
    };
    partnerByKey.set(id, fresh);
    return fresh;
  }
  for (const v of rangeVisits) {
    const p = partnerBucket(v.site?.partnerId, v.site?.partner?.name);
    if (p) {
      p.asCustomer.activities++;
      p.asCustomer.billed += Number(v.billedAmount ?? 0);
    }
  }
  for (const j of rangeJobs) {
    const asCust = partnerBucket(j.partnerId, j.partner?.name);
    if (asCust) {
      asCust.asCustomer.activities++;
      asCust.asCustomer.billed += Number(j.billedAmount ?? 0);
    }
    const asSub = partnerBucket(
      j.handledByPartnerId,
      j.handledByPartner?.name,
    );
    if (asSub) {
      asSub.asSubcontractor.activities++;
      asSub.asSubcontractor.billed += Number(j.billedAmount ?? 0);
    }
  }
  const partnerRows = Array.from(partnerByKey.values()).sort(
    (a, b) =>
      b.asCustomer.billed +
      b.asSubcontractor.billed -
      (a.asCustomer.billed + a.asSubcontractor.billed),
  );

  // Per-site P&L for the "Top sites" leaderboard. We bucket visits and
  // jobs by siteId, then sort by billed desc and take the top 10. Margin
  // is billed - paid (whole-officer pay across the site for the range);
  // it's directional, not a true unit-economics figure since fixed costs
  // (retainer, kit) don't fold in here.
  type SiteBucket = {
    id: string;
    label: string;
    activities: number;
    billed: number;
    paid: number;
  };
  const siteByKey = new Map<string, SiteBucket>();
  function siteBucket(
    id: string | null | undefined,
    label: string | null | undefined,
  ): SiteBucket | null {
    if (!id) return null;
    const existing = siteByKey.get(id);
    if (existing) return existing;
    const fresh: SiteBucket = {
      id,
      label: label ?? "Unknown site",
      activities: 0,
      billed: 0,
      paid: 0,
    };
    siteByKey.set(id, fresh);
    return fresh;
  }
  for (const v of rangeVisits) {
    const name = v.site?.code
      ? `${v.site.code} · ${v.site.name}`
      : v.site?.name;
    const s = siteBucket(v.siteId, name);
    if (!s) continue;
    s.activities++;
    s.billed += Number(v.billedAmount ?? 0);
    s.paid += Number(v.paidAmount ?? 0);
  }
  for (const j of rangeJobs) {
    const name = j.site?.code
      ? `${j.site.code} · ${j.site.name}`
      : j.site?.name;
    const s = siteBucket(j.siteId, name);
    if (!s) continue;
    s.activities++;
    s.billed += Number(j.billedAmount ?? 0);
    s.paid += Number(j.paidAmount ?? 0);
  }
  const topSitesByRevenue = Array.from(siteByKey.values())
    .sort((a, b) => b.billed - a.billed)
    .slice(0, 10);
  const topSitesByActivity = Array.from(siteByKey.values())
    .sort((a, b) => b.activities - a.activities)
    .slice(0, 10);

  const pnlTotals = pnlRows.reduce(
    (acc, r) => ({
      billed: acc.billed + r.billed,
      paid: acc.paid + r.paid,
      activities: acc.activities + r.activities,
    }),
    { billed: 0, paid: 0, activities: 0 },
  );

  return (
    <div className="section">
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
          <Link href="/finance/activities" className="btn-secondary text-sm">
            Activities log →
          </Link>
          <Link href="/finance/payroll" className="btn-secondary text-sm">
            Payroll →
          </Link>
          <RecalcButton
            recalc={recalculateBilling}
            from={fromDate.toISOString()}
            to={toDate.toISOString()}
          />
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
        {/* Today gets the brand accent stripe — it's the live, always-now
            number admins glance at first. */}
        <div className="card-accent p-5 flex flex-col gap-1.5">
          <div className="kpi-label">Earned today</div>
          <div className="kpi-value">{fmtMoney2(earnedToday)}</div>
          <div className="kpi-hint">since midnight</div>
        </div>
        <div className="kpi">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="kpi-label">Earned in range</div>
              <div className="kpi-value">{fmtMoney2(earnedRange)}</div>
            </div>
            <Sparkline
              values={dailyBilled}
              ariaLabel="Daily billed for the last 14 days"
              fill="#3B82F6"
            />
          </div>
          <div className="kpi-hint">
            {fromDate.toLocaleDateString("en-GB", { timeZone: "Europe/London" })} →{" "}
            {toDate.toLocaleDateString("en-GB", { timeZone: "Europe/London" })} · trend: last 14 days
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Previous period</div>
          <div className="kpi-value">{fmtMoney2(earnedPrev)}</div>
          <div
            className={
              "text-xs " +
              (rangeDelta == null
                ? "text-slate-500"
                : rangeDelta >= 0
                  ? "text-brand-blue-dark"
                  : "text-red-600")
            }
          >
            {rangeDelta == null
              ? "No prior data to compare"
              : `${rangeDelta >= 0 ? "↑" : "↓"} ${Math.abs(rangeDelta).toFixed(0)}% vs same-length window before`}
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
            selected range ({fromDate.toLocaleDateString("en-GB", { timeZone: "Europe/London" })} →{" "}
            {toDate.toLocaleDateString("en-GB", { timeZone: "Europe/London" })}). Scheduled work doesn't
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
              const activitiesHref = `/finance/activities?accountId=${encodeURIComponent(r.key)}&from=${ymd(fromDate)}&to=${ymd(toDate)}`;
              return (
                <tr key={r.key}>
                  <td className="px-4 py-2 font-medium text-brand-navy">
                    {r.key === "unassigned" ? (
                      r.label
                    ) : (
                      <Link
                        href={activitiesHref}
                        className="hover:text-brand-blue-dark hover:underline"
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
                        className="text-brand-navy hover:text-brand-blue-dark hover:underline"
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

      <TopSitesTables
        byRevenue={topSitesByRevenue}
        byActivity={topSitesByActivity}
        from={fromDate}
        to={toDate}
      />

      <PartnerPnlTable rows={partnerRows} from={fromDate} to={toDate} />

      <OfficerPnlTable rows={officerRows} from={fromDate} to={toDate} />

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
                  ? `/finance/activities?accountId=${encodeURIComponent(owner)}&from=${ymd(fromDate)}&to=${ymd(toDate)}`
                  : null;
                return (
                <tr key={g.label}>
                  <td className="px-4 py-2 text-brand-navy font-medium">
                    {activitiesHref ? (
                      <Link
                        href={activitiesHref}
                        className="hover:text-brand-blue-dark hover:underline"
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
                        className="text-brand-navy hover:text-brand-blue-dark font-medium"
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

// ── P&L sub-tables ─────────────────────────────────────────────────────

function TopSitesTables({
  byRevenue,
  byActivity,
  from,
  to,
}: {
  byRevenue: {
    id: string;
    label: string;
    activities: number;
    billed: number;
    paid: number;
  }[];
  byActivity: {
    id: string;
    label: string;
    activities: number;
    billed: number;
    paid: number;
  }[];
  from: Date;
  to: Date;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <TopSitesCard
        title="Top sites by revenue"
        blurb="Highest billed sites in the selected range."
        rows={byRevenue}
        metricLabel="Billed"
        metricFor={(r) => fmtMoney2(r.billed)}
        marginFor={(r) => r.billed - r.paid}
        from={from}
        to={to}
      />
      <TopSitesCard
        title="Top sites by activity"
        blurb="Sites with the most jobs + visits in the range."
        rows={byActivity}
        metricLabel="Activities"
        metricFor={(r) => r.activities.toLocaleString("en-GB")}
        from={from}
        to={to}
      />
    </div>
  );
}

function TopSitesCard({
  title,
  blurb,
  rows,
  metricLabel,
  metricFor,
  marginFor,
  from,
  to,
}: {
  title: string;
  blurb: string;
  rows: {
    id: string;
    label: string;
    activities: number;
    billed: number;
    paid: number;
  }[];
  metricLabel: string;
  metricFor: (r: {
    id: string;
    label: string;
    activities: number;
    billed: number;
    paid: number;
  }) => string;
  marginFor?: (r: {
    id: string;
    label: string;
    activities: number;
    billed: number;
    paid: number;
  }) => number;
  from: Date;
  to: Date;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold text-brand-navy">{title}</h2>
        <p className="text-xs text-slate-500">{blurb}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">
          No site activity in this range.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs w-8">
                #
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Site
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                {metricLabel}
              </th>
              {marginFor && (
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Margin
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const margin = marginFor?.(r);
              const accountHref = `/sites/${r.id}`;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-slate-400 tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={accountHref}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {r.label}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {metricFor(r)}
                  </td>
                  {marginFor && (
                    <td
                      className={
                        "px-4 py-2 text-right tabular-nums font-medium " +
                        ((margin ?? 0) >= 0
                          ? "text-brand-navy"
                          : "text-red-600")
                      }
                    >
                      {fmtMoney2(margin ?? 0)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OfficerPnlTable({
  rows,
  from,
  to,
}: {
  rows: { id: string; name: string; activities: number; paid: number }[];
  from: Date;
  to: Date;
}) {
  const total = rows.reduce(
    (acc, r) => ({
      activities: acc.activities + r.activities,
      paid: acc.paid + r.paid,
    }),
    { activities: 0, paid: 0 },
  );
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between">
        <div>
          <h2 className="font-semibold text-brand-navy">Officers</h2>
          <p className="text-xs text-slate-500">
            Per-officer activity count and pay. Click an officer to see
            their activities in the selected range.
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">
          No officer activity in this range.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Officer
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Activities
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Pay
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  <Link
                    href={`/finance/officers/${r.id}?from=${ymd(from)}&to=${ymd(to)}`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.activities}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtMoney2(r.paid)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <td className="px-4 py-2 text-slate-600">Total</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {total.activities}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmtMoney2(total.paid)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function PartnerPnlTable({
  rows,
  from,
  to,
}: {
  rows: {
    id: string;
    name: string;
    asCustomer: { activities: number; billed: number };
    asSubcontractor: { activities: number; billed: number };
  }[];
  from: Date;
  to: Date;
}) {
  const total = rows.reduce(
    (acc, r) => ({
      cActs: acc.cActs + r.asCustomer.activities,
      cBilled: acc.cBilled + r.asCustomer.billed,
      sActs: acc.sActs + r.asSubcontractor.activities,
      sBilled: acc.sBilled + r.asSubcontractor.billed,
    }),
    { cActs: 0, cBilled: 0, sActs: 0, sBilled: 0 },
  );
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold text-brand-navy">Partners</h2>
        <p className="text-xs text-slate-500">
          Two-sided per partner: jobs <em>we did for them</em> (they're our
          customer) vs jobs <em>they did for us</em> (we subcontracted to
          them). Click for the split detail.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">
          No partner activity in this range.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Partner
              </th>
              <th
                className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs"
                colSpan={2}
              >
                We did for them
              </th>
              <th
                className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs"
                colSpan={2}
              >
                They did for us
              </th>
            </tr>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50">
              <th></th>
              <th className="text-right px-4 py-1 font-normal">Activities</th>
              <th className="text-right px-4 py-1 font-normal">Billed to them</th>
              <th className="text-right px-4 py-1 font-normal">Activities</th>
              <th className="text-right px-4 py-1 font-normal">
                Billed to our customer
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  <Link
                    href={`/finance/partners/${r.id}?from=${ymd(from)}&to=${ymd(to)}`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.asCustomer.activities}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtMoney2(r.asCustomer.billed)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.asSubcontractor.activities}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtMoney2(r.asSubcontractor.billed)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <td className="px-4 py-2 text-slate-600">Total</td>
              <td className="px-4 py-2 text-right tabular-nums">{total.cActs}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmtMoney2(total.cBilled)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{total.sActs}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmtMoney2(total.sBilled)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
