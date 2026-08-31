import Link from "next/link";
import { Sun, Calendar, History, TrendingUp, TrendingDown } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { recalculateBilling } from "./_actions";
import { RecalcButton } from "./_components/RecalcButton";
import { Sparkline } from "@/components/Sparkline";
import { PageHeader } from "@/components/PageHeader";
import { TrendChart } from "@/components/TrendChart";
import { BarList } from "@/components/BarList";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

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
    const [v, j, s] = await prisma.$transaction([
      prisma.patrolVisit.aggregate({
        _sum: { billedAmount: true },
        where: {
          status: "COMPLETED",
          ...visitScheduledRange(from, to),
        },
      }),
      prisma.job.aggregate({
        _sum: { billedAmount: true },
        where: {
          // Only work actually done, attributed to its scheduled month.
          completedAt: { not: null },
          status: { not: "CANCELLED" },
          ...jobScheduledRange(from, to),
        },
      }),
      prisma.shift.aggregate({
        _sum: { billedAmount: true },
        where: {
          status: "COMPLETED",
          ...shiftScheduledRange(from, to),
        },
      }),
    ]);
    return (
      Number(v._sum.billedAmount ?? 0) +
      Number(j._sum.billedAmount ?? 0) +
      Number(s._sum.billedAmount ?? 0)
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
      UNION ALL
      SELECT date_trunc('day', "actualEndedAt") AS day, "billedAmount" AS amount
      FROM "Shift"
      WHERE "actualEndedAt" BETWEEN ${sparkStart} AND ${sparkEnd}
        AND "status" = 'COMPLETED'
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

  const [rangeVisits, rangeJobs, rangeShifts] = await Promise.all([
    prisma.patrolVisit.findMany({
      where: {
        status: "COMPLETED",
        ...visitScheduledRange(fromDate, toDate),
      },
      select: {
        billedAmount: true,
        paidAmount: true,
        officerId: true,
        officer: { select: { name: true } },
        siteId: true,
        patrolSchedule: { select: { kind: true } },
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            customerId: true,
            customer: { select: { name: true } },
            partnerId: true,
            partner: { select: { name: true } },
            regionId: true,
            region: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.job.findMany({
      where: {
        completedAt: { not: null },
        status: { not: "CANCELLED" },
        ...jobScheduledRange(fromDate, toDate),
      },
      select: {
        billedAmount: true,
        paidAmount: true,
        type: true,
        siteId: true,
        site: {
          select: {
            name: true,
            code: true,
            // Pull the site's owner so jobs created before admin
            // assigned a customer/partner to the site still bucket
            // correctly — falls back to these when j.customerId /
            // j.partnerId are null.
            customerId: true,
            customer: { select: { name: true } },
            partnerId: true,
            partner: { select: { name: true } },
            regionId: true,
            region: { select: { id: true, name: true } },
          },
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
    // Shifts anchor on actualEndedAt so a shift that spans midnight
    // bills to the day it finished. Officer-pay and partner-charge
    // are surfaced separately downstream.
    prisma.shift.findMany({
      where: {
        status: "COMPLETED",
        ...shiftScheduledRange(fromDate, toDate),
      },
      select: {
        billedAmount: true,
        paidAmount: true,
        partnerChargeToUsAmount: true,
        type: true,
        siteId: true,
        officerId: true,
        officer: { select: { name: true } },
        handledByPartnerId: true,
        handledByPartner: { select: { name: true } },
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            customerId: true,
            customer: { select: { name: true } },
            partnerId: true,
            partner: { select: { name: true } },
            regionId: true,
            region: { select: { id: true, name: true } },
          },
        },
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
    // Fall back to the site's owner when the Job's own column is null
    // — happens for Jobs created before admin assigned the site's
    // customer/partner. Recompute now self-heals these too, but we
    // still want the read path to be correct without requiring it.
    const customerId = j.customerId ?? j.site?.customerId ?? null;
    const customerName =
      j.customer?.name ?? j.site?.customer?.name ?? null;
    const partnerId = j.partnerId ?? j.site?.partnerId ?? null;
    const partnerName = j.partner?.name ?? j.site?.partner?.name ?? null;
    const b = bucketFor(customerId, customerName, partnerId, partnerName);
    b.billed += Number(j.billedAmount ?? 0);
    b.paid += Number(j.paidAmount ?? 0);
    b.activities++;
  }
  for (const s of rangeShifts) {
    // Shifts inherit their bill-to from the site. For partner-handled
    // shifts the cost we owe the partner is `partnerChargeToUsAmount`
    // — fold that into `paid` so the P&L profit column reflects our
    // real outgoings whether the work was done by an officer or a
    // subcontractor.
    const b = bucketFor(
      s.site?.customerId ?? null,
      s.site?.customer?.name ?? null,
      s.site?.partnerId ?? null,
      s.site?.partner?.name ?? null,
    );
    b.billed += Number(s.billedAmount ?? 0);
    b.paid +=
      Number(s.paidAmount ?? 0) + Number(s.partnerChargeToUsAmount ?? 0);
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
  for (const s of rangeShifts) {
    // Officer-handled shifts only — partner-handled shifts don't
    // belong to any of our officers, even though they show on the
    // partner side of partnerByKey.
    const o = officerBucket(s.officerId, s.officer?.name);
    if (!o) continue;
    o.activities++;
    o.paid += Number(s.paidAmount ?? 0);
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
    // Same fallback as the P&L bucketing above — site's partner wins
    // when the Job hasn't had its column backfilled yet.
    const partnerIdForJob = j.partnerId ?? j.site?.partnerId ?? null;
    const partnerNameForJob =
      j.partner?.name ?? j.site?.partner?.name ?? null;
    const asCust = partnerBucket(partnerIdForJob, partnerNameForJob);
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
  for (const s of rangeShifts) {
    // Partner as customer — shift on a site they bill us through.
    const asCust = partnerBucket(s.site?.partnerId, s.site?.partner?.name);
    if (asCust) {
      asCust.asCustomer.activities++;
      asCust.asCustomer.billed += Number(s.billedAmount ?? 0);
    }
    // Partner as subcontractor — shift we sent them to handle.
    const asSub = partnerBucket(
      s.handledByPartnerId,
      s.handledByPartner?.name,
    );
    if (asSub) {
      asSub.asSubcontractor.activities++;
      asSub.asSubcontractor.billed += Number(s.billedAmount ?? 0);
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
  for (const sh of rangeShifts) {
    const name = sh.site?.code
      ? `${sh.site.code} · ${sh.site.name}`
      : sh.site?.name;
    const s = siteBucket(sh.siteId, name);
    if (!s) continue;
    s.activities++;
    s.billed += Number(sh.billedAmount ?? 0);
    s.paid +=
      Number(sh.paidAmount ?? 0) + Number(sh.partnerChargeToUsAmount ?? 0);
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

  // Revenue by service line — where the money in this range actually came
  // from. Visits map to Patrol / VPI via their schedule kind; jobs map via
  // their type using the same RATE_LABEL the rest of the page uses.
  const serviceByKey = new Map<string, number>();
  const addService = (label: string, amount: number) => {
    serviceByKey.set(label, (serviceByKey.get(label) ?? 0) + amount);
  };
  for (const v of rangeVisits) {
    const label = v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol";
    addService(label, Number(v.billedAmount ?? 0));
  }
  for (const j of rangeJobs) {
    addService(RATE_LABEL[j.type] ?? j.type.replace(/_/g, " "), Number(j.billedAmount ?? 0));
  }
  for (const s of rangeShifts) {
    addService(
      RATE_LABEL[s.type] ?? s.type.replace(/_/g, " "),
      Number(s.billedAmount ?? 0),
    );
  }
  const revenueByService = Array.from(serviceByKey.entries())
    .map(([label, value]) => ({ label, value }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // Revenue + activity by region. Same shape as serviceByKey, but
  // bucket by site.region.name. Sites without a region land in
  // "No region" so the total still reconciles with revenue-by-service.
  type RegionBucket = { name: string; activities: number; billed: number };
  const regionByKey = new Map<string, RegionBucket>();
  const addRegion = (name: string, amount: number) => {
    const row =
      regionByKey.get(name) ??
      ({ name, activities: 0, billed: 0 } as RegionBucket);
    row.activities += 1;
    row.billed += amount;
    regionByKey.set(name, row);
  };
  for (const v of rangeVisits) {
    addRegion(v.site?.region?.name ?? "No region", Number(v.billedAmount ?? 0));
  }
  for (const j of rangeJobs) {
    addRegion(j.site?.region?.name ?? "No region", Number(j.billedAmount ?? 0));
  }
  for (const s of rangeShifts) {
    addRegion(s.site?.region?.name ?? "No region", Number(s.billedAmount ?? 0));
  }
  const revenueByRegion = Array.from(regionByKey.values()).sort(
    (a, b) => b.billed - a.billed,
  );

  // Top accounts by billed revenue in range — the headline of the P&L
  // table, surfaced as a bar list so the relative scale reads instantly.
  const topAccountsBilled = pnlRows
    .filter((r) => r.billed > 0)
    .slice(0, 6);

  // 14-day axis labels for the trend chart (sparkStart … sparkEnd).
  const trendLabels: string[] = [];
  for (let i = 0; i < dailyBilled.length; i++) {
    const d = new Date(sparkStart);
    d.setDate(sparkStart.getDate() + i);
    trendLabels.push(
      d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    );
  }

  return (
    <div className="section">
      <PageHeader
        title="Finance"
        subtitle={
          <>
            What we bill across all sites and customers. Per-visit and
            per-job amounts are auto-snapshotted from{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">SiteRate</code>
            . Officer pay rates and excess-time surcharge are next.
          </>
        }
        actions={
          <>
            <Link href="/finance/activities" className="btn-secondary text-sm">
              Activities log →
            </Link>
            <Link href="/finance/payroll" className="btn-secondary text-sm">
              Payroll →
            </Link>
            <Link
              href={`/finance/exceptions?from=${ymd(fromDate)}&to=${ymd(toDate)}`}
              className="btn-secondary text-sm"
            >
              Exceptions →
            </Link>
            <RecalcButton
              recalc={recalculateBilling}
              from={fromDate.toISOString()}
              to={toDate.toISOString()}
            />
          </>
        }
      />

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
          <div className="kpi-label inline-flex items-center gap-1.5">
            <Sun size={13} className="text-brand-blue" /> Earned today
          </div>
          <div className="kpi-value">{fmtMoney2(earnedToday)}</div>
          <div className="kpi-hint">since midnight</div>
        </div>
        <div className="kpi">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="kpi-label inline-flex items-center gap-1.5">
                <Calendar size={13} className="text-slate-400" /> Earned in range
              </div>
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
          <div className="kpi-label inline-flex items-center gap-1.5">
            <History size={13} className="text-slate-400" /> Previous period
          </div>
          <div className="kpi-value">{fmtMoney2(earnedPrev)}</div>
          <div
            className={
              "text-xs inline-flex items-center gap-1 " +
              (rangeDelta == null
                ? "text-slate-500"
                : rangeDelta >= 0
                  ? "text-success"
                  : "text-red-600")
            }
          >
            {rangeDelta == null ? (
              "No prior data to compare"
            ) : (
              <>
                {rangeDelta >= 0 ? (
                  <TrendingUp size={12} />
                ) : (
                  <TrendingDown size={12} />
                )}
                {Math.abs(rangeDelta).toFixed(0)}% vs same-length window before
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Revenue analytics ─────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">Billed — last 14 days</h2>
            <p className="text-xs text-slate-500">
              Completed visits + jobs, per day. Peak day labelled.
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-brand-navy tabular-nums leading-none">
              {fmtMoney(dailyBilled.reduce((a, b) => a + b, 0))}
            </div>
            <div className="text-[11px] text-slate-500">14-day total</div>
          </div>
        </div>
        <div className="p-4">
          <TrendChart
            values={dailyBilled}
            labels={trendLabels}
            height={140}
            ariaLabel="Daily billed revenue over the last 14 days"
            formatValue={(n) => fmtMoney(n)}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Revenue by service</h2>
            <p className="text-xs text-slate-500">In range · billed</p>
          </div>
          <BarList
            items={revenueByService.map((s) => ({
              label: s.label,
              value: s.value,
              display: fmtMoney(s.value),
            }))}
            emptyLabel="No completed work in range."
          />
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Top accounts by billed</h2>
            <p className="text-xs text-slate-500">
              In range · click through to the account's activity ledger.
            </p>
          </div>
          <BarList
            tone="navy"
            items={topAccountsBilled.map((r) => ({
              label: r.label,
              value: r.billed,
              display: fmtMoney(r.billed),
              hint: `${r.activities} ${r.activities === 1 ? "activity" : "activities"}`,
              href:
                r.key === "unassigned"
                  ? undefined
                  : `/finance/activities?accountId=${encodeURIComponent(r.key)}&from=${ymd(fromDate)}&to=${ymd(toDate)}`,
            }))}
            emptyLabel="Nothing billed in range yet."
          />
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Revenue by region</h2>
            <p className="text-xs text-slate-500">
              Activities + billed per operating region
            </p>
          </div>
          <BarList
            tone="amber"
            items={revenueByRegion.map((r) => ({
              label: r.name,
              value: r.billed,
              display: fmtMoney(r.billed),
              hint: `${r.activities} ${r.activities === 1 ? "activity" : "activities"}`,
            }))}
            emptyLabel="No completed work in range."
          />
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
        <div className="table-scroll">
        <table className="table-default">
          <thead>
            <tr>
              <th>Account</th>
              <th className="col-num">Activities</th>
              <th className="col-num">Billed</th>
              <th className="col-num">Officer pay</th>
              <th className="col-num">Profit</th>
              <th className="col-num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {pnlRows.map((r) => {
              const profit = r.billed - r.paid;
              const margin = r.billed > 0 ? (profit / r.billed) * 100 : 0;
              const activitiesHref = `/finance/activities?accountId=${encodeURIComponent(r.key)}&from=${ymd(fromDate)}&to=${ymd(toDate)}`;
              return (
                <tr key={r.key}>
                  <td className="font-medium text-brand-navy">
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
                  <td className="col-num">
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
                  <td className="col-num">{fmtMoney2(r.billed)}</td>
                  <td className="col-num text-slate-600">{fmtMoney2(r.paid)}</td>
                  <td
                    className={
                      "col-num font-medium " +
                      (profit >= 0 ? "text-brand-navy" : "text-red-600")
                    }
                  >
                    {fmtMoney2(profit)}
                  </td>
                  <td
                    className={
                      "col-num text-xs " +
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
                <td className="text-brand-navy">Total</td>
                <td className="col-num">{pnlTotals.activities}</td>
                <td className="col-num">{fmtMoney2(pnlTotals.billed)}</td>
                <td className="col-num text-slate-700">
                  {fmtMoney2(pnlTotals.paid)}
                </td>
                <td
                  className={
                    "col-num " +
                    (pnlTotals.billed - pnlTotals.paid >= 0
                      ? "text-brand-navy"
                      : "text-red-600")
                  }
                >
                  {fmtMoney2(pnlTotals.billed - pnlTotals.paid)}
                </td>
                <td className="col-num text-xs text-slate-600">
                  {pnlTotals.billed > 0
                    ? `${(((pnlTotals.billed - pnlTotals.paid) / pnlTotals.billed) * 100).toFixed(0)}%`
                    : "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <TopSitesTables
        byRevenue={topSitesByRevenue}
        byActivity={topSitesByActivity}
        from={fromDate}
        to={toDate}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <PartnerPnlTable rows={partnerRows} from={fromDate} to={toDate} />
        <OfficerPnlTable rows={officerRows} from={fromDate} to={toDate} />
      </div>


      <div className="card-subtle p-4">
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
        <div className="table-scroll">
        <table className="table-default">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Site</th>
              <th className="col-num">{metricLabel}</th>
              {marginFor && <th className="col-num">Margin</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const margin = marginFor?.(r);
              const accountHref = `/sites/${r.id}`;
              return (
                <tr key={r.id}>
                  <td className="text-slate-400 tabular-nums">{i + 1}</td>
                  <td>
                    <Link
                      href={accountHref}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {r.label}
                    </Link>
                  </td>
                  <td className="col-num">{metricFor(r)}</td>
                  {marginFor && (
                    <td
                      className={
                        "col-num font-medium " +
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
        </div>
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
        <div className="table-scroll">
        <table className="table-default">
          <thead>
            <tr>
              <th>Officer</th>
              <th className="col-num">Activities</th>
              <th className="col-num">Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    href={`/finance/officers/${r.id}?from=${ymd(from)}&to=${ymd(to)}`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="col-num">{r.activities}</td>
                <td className="col-num">{fmtMoney2(r.paid)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="text-slate-600">Total</td>
              <td className="col-num">{total.activities}</td>
              <td className="col-num">{fmtMoney2(total.paid)}</td>
            </tr>
          </tbody>
        </table>
        </div>
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
        <div className="table-scroll">
        <table className="table-default">
          <thead>
            <tr>
              <th>Partner</th>
              <th className="col-num" colSpan={2}>
                We did for them
              </th>
              <th className="col-num" colSpan={2}>
                They did for us
              </th>
            </tr>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50">
              <th></th>
              <th className="text-right px-4 py-1 font-normal normal-case">
                Activities
              </th>
              <th className="text-right px-4 py-1 font-normal normal-case">
                Billed to them
              </th>
              <th className="text-right px-4 py-1 font-normal normal-case">
                Activities
              </th>
              <th className="text-right px-4 py-1 font-normal normal-case">
                Billed to our customer
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    href={`/finance/partners/${r.id}?from=${ymd(from)}&to=${ymd(to)}`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="col-num">{r.asCustomer.activities}</td>
                <td className="col-num">{fmtMoney2(r.asCustomer.billed)}</td>
                <td className="col-num">{r.asSubcontractor.activities}</td>
                <td className="col-num">
                  {fmtMoney2(r.asSubcontractor.billed)}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="text-slate-600">Total</td>
              <td className="col-num">{total.cActs}</td>
              <td className="col-num">{fmtMoney2(total.cBilled)}</td>
              <td className="col-num">{total.sActs}</td>
              <td className="col-num">{fmtMoney2(total.sBilled)}</td>
            </tr>
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
