/**
 * Data layer for the read-only client portal (/client/*).
 *
 * Everything here is scoped to ONE customer and is deliberately CLIENT-SAFE:
 *   - Activities are reached through the site (`site.customerId`), so a client
 *     only ever sees work on their own sites.
 *   - Money is limited to `billedAmount` — what we charge the client. Officer
 *     pay (`paidAmount`), subcontractor cost (`partnerChargeToUsAmount`),
 *     margin, and rate cards are NEVER selected here.
 *   - Officer identity is never returned — the client sees that work was done,
 *     not who did it.
 *
 * Attribution uses the app-wide scheduled-date rule (see activityWhen).
 */
import { prisma } from "@/lib/db";
import {
  jobWhen,
  visitWhen,
  shiftWhen,
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

export type ClientActivityStatus = "Completed" | "In progress" | "Scheduled";

export type ClientActivity = {
  id: string;
  kind: string;
  siteId: string;
  siteName: string;
  siteCode: string | null;
  at: Date;
  status: ClientActivityStatus;
};

/** Internal shape — carries billedAmount for aggregation; never sent as-is to a client. */
type RawActivity = ClientActivity & { billed: number };

const JOB_KIND: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  PATROL: "Patrol",
};

function jobStatus(s: string): ClientActivityStatus {
  if (s === "IN_PROGRESS") return "In progress";
  if (s === "OPEN" || s === "ASSIGNED") return "Scheduled";
  return "Completed"; // SUBMITTED / REVIEW_PENDING / APPROVED / SENT_TO_CLIENT / CLOSED
}
function pendingStatus(s: string): ClientActivityStatus {
  if (s === "IN_PROGRESS") return "In progress";
  if (s === "COMPLETED") return "Completed";
  return "Scheduled"; // PENDING
}

function num(d: unknown): number {
  if (d == null) return 0;
  const n = Number(d as any);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch every client-visible activity (jobs + patrol visits + guarding shifts)
 * on the customer's sites in [from, to]. Cancelled work is excluded; so are
 * missed/late visits and missed/abandoned shifts (a no-show isn't "work done"
 * and shouldn't surface to a client unprompted).
 */
async function fetchRaw(
  customerId: string,
  from: Date,
  to: Date,
  siteId?: string | null,
): Promise<RawActivity[]> {
  const siteWhere = {
    is: { customerId, ...(siteId ? { id: siteId } : {}) },
  };

  const [jobs, visits, shifts] = await Promise.all([
    prisma.job.findMany({
      where: {
        site: siteWhere,
        status: { not: "CANCELLED" },
        ...jobScheduledRange(from, to),
      },
      take: 5000,
      select: {
        id: true,
        type: true,
        typeLabel: true,
        status: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        billedAmount: true,
        site: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.patrolVisit.findMany({
      where: {
        site: siteWhere,
        status: { notIn: ["CANCELLED", "MISSED", "LATE"] },
        ...visitScheduledRange(from, to),
      },
      take: 5000,
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        billedAmount: true,
        patrolSchedule: { select: { kind: true } },
        site: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.shift.findMany({
      where: {
        site: siteWhere,
        status: { notIn: ["MISSED", "ABANDONED"] },
        ...shiftScheduledRange(from, to),
      },
      take: 5000,
      select: {
        id: true,
        type: true,
        status: true,
        scheduledStartsAt: true,
        billedAmount: true,
        site: { select: { id: true, name: true, code: true } },
      },
    }),
  ]);

  const out: RawActivity[] = [];

  for (const j of jobs) {
    if (!j.site) continue;
    out.push({
      id: `job:${j.id}`,
      kind: j.typeLabel ?? JOB_KIND[j.type] ?? j.type.replace(/_/g, " "),
      siteId: j.site.id,
      siteName: j.site.name,
      siteCode: j.site.code,
      at: jobWhen(j) ?? j.createdAt ?? to,
      status: jobStatus(j.status),
      billed: num(j.billedAmount),
    });
  }
  for (const v of visits) {
    if (!v.site) continue;
    out.push({
      id: `visit:${v.id}`,
      kind: v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol",
      siteId: v.site.id,
      siteName: v.site.name,
      siteCode: v.site.code,
      at: visitWhen(v),
      status: pendingStatus(v.status),
      billed: num(v.billedAmount),
    });
  }
  for (const s of shifts) {
    if (!s.site) continue;
    out.push({
      id: `shift:${s.id}`,
      kind: s.type === "DOG_HANDLER" ? "Dog handler" : "Static guarding",
      siteId: s.site.id,
      siteName: s.site.name,
      siteCode: s.site.code,
      at: shiftWhen(s),
      status: pendingStatus(s.status),
      billed: num(s.billedAmount),
    });
  }

  return out;
}

// ── Pure aggregation (unit-tested) ────────────────────────────────────────

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  month: "short",
  year: "numeric",
});
const MONTH_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
});

/** "YYYY-MM" in UK time. */
export function ukMonthKey(d: Date): string {
  return MONTH_KEY_FMT.format(d).slice(0, 7);
}
/** "Sep 2026" from a "YYYY-MM" key. */
export function ukMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 15, 12)));
}
/** Inclusive list of "YYYY-MM" keys spanning [from, to]. */
export function monthKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth();
  // Cap at 24 buckets so a silly range can't explode the chart.
  for (let i = 0; i < 24; i++) {
    keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    if (y === endY && m === endM) break;
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return keys;
}

export type ClientSummary = {
  totalActivities: number;
  totalSpend: number;
  byKind: { label: string; count: number }[];
  spendBySite: { siteId: string; siteName: string; amount: number }[];
  activityByMonth: { key: string; label: string; count: number }[];
  spendByMonth: { key: string; label: string; amount: number }[];
};

/** Roll a set of raw activities into the portal's KPIs, breakdowns and trends. */
export function summariseClientActivities(
  rows: RawActivity[],
  monthKeys: string[],
): ClientSummary {
  const byKind = new Map<string, number>();
  const bySite = new Map<string, { siteName: string; amount: number }>();
  const actByMonth = new Map<string, number>();
  const spendByMonth = new Map<string, number>();
  let totalSpend = 0;

  for (const k of monthKeys) {
    actByMonth.set(k, 0);
    spendByMonth.set(k, 0);
  }

  for (const r of rows) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    const site = bySite.get(r.siteId) ?? { siteName: r.siteName, amount: 0 };
    site.amount += r.billed;
    bySite.set(r.siteId, site);
    totalSpend += r.billed;
    const mk = ukMonthKey(r.at);
    if (actByMonth.has(mk)) actByMonth.set(mk, (actByMonth.get(mk) ?? 0) + 1);
    if (spendByMonth.has(mk))
      spendByMonth.set(mk, (spendByMonth.get(mk) ?? 0) + r.billed);
  }

  return {
    totalActivities: rows.length,
    totalSpend,
    byKind: Array.from(byKind, ([label, count]) => ({ label, count })).sort(
      (a, b) => b.count - a.count,
    ),
    spendBySite: Array.from(bySite, ([siteId, v]) => ({
      siteId,
      siteName: v.siteName,
      amount: v.amount,
    })).sort((a, b) => b.amount - a.amount),
    activityByMonth: monthKeys.map((key) => ({
      key,
      label: ukMonthLabel(key),
      count: actByMonth.get(key) ?? 0,
    })),
    spendByMonth: monthKeys.map((key) => ({
      key,
      label: ukMonthLabel(key),
      amount: spendByMonth.get(key) ?? 0,
    })),
  };
}

// ── Public loaders ────────────────────────────────────────────────────────

/** Recent client-visible activities (no officer identity), newest first. */
export async function loadClientActivities(
  customerId: string,
  opts: { from: Date; to: Date; siteId?: string | null; limit?: number },
): Promise<ClientActivity[]> {
  const rows = await fetchRaw(customerId, opts.from, opts.to, opts.siteId);
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  const trimmed = opts.limit ? rows.slice(0, opts.limit) : rows;
  // Strip the internal billed field before returning.
  return trimmed.map(({ billed: _billed, ...rest }) => rest);
}

export type ClientSiteRow = {
  id: string;
  name: string;
  code: string | null;
  regionName: string | null;
  activityCount: number;
  spend: number;
  lastActivityAt: Date | null;
};

/** Every one of the customer's sites, with in-range activity count + spend. */
export async function loadClientSites(
  customerId: string,
  opts: { from: Date; to: Date },
): Promise<ClientSiteRow[]> {
  const [sites, rows] = await Promise.all([
    prisma.site.findMany({
      where: { customerId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        region: { select: { name: true } },
      },
    }),
    fetchRaw(customerId, opts.from, opts.to),
  ]);

  const agg = new Map<string, { count: number; spend: number; last: Date | null }>();
  for (const r of rows) {
    const a = agg.get(r.siteId) ?? { count: 0, spend: 0, last: null };
    a.count++;
    a.spend += r.billed;
    if (!a.last || r.at > a.last) a.last = r.at;
    agg.set(r.siteId, a);
  }

  return sites.map((s) => {
    const a = agg.get(s.id);
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      regionName: s.region?.name ?? null,
      activityCount: a?.count ?? 0,
      spend: a?.spend ?? 0,
      lastActivityAt: a?.last ?? null,
    };
  });
}

export type ClientOverview = ClientSummary & {
  siteCount: number;
  recent: ClientActivity[];
};

/** Everything the home dashboard + spend + site-detail pages need for a range. */
export async function loadClientOverview(
  customerId: string,
  opts: { from: Date; to: Date; siteId?: string | null },
): Promise<ClientOverview> {
  const [rows, siteCount] = await Promise.all([
    fetchRaw(customerId, opts.from, opts.to, opts.siteId),
    prisma.site.count({ where: { customerId } }),
  ]);
  const summary = summariseClientActivities(
    rows,
    monthKeysBetween(opts.from, opts.to),
  );
  const recent = [...rows]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8)
    .map(({ billed: _billed, ...rest }) => rest);
  return { ...summary, siteCount, recent };
}
