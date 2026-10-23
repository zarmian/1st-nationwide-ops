/**
 * Data layer for the read-only client portal (/client/*).
 *
 * Everything here is scoped to ONE customer and is deliberately CLIENT-SAFE:
 *   - Activities are reached through the site (`site.customerId`), so a client
 *     only ever sees work on their own sites.
 *   - Money is limited to `billedAmount` — what we charge the client, shown
 *     per activity (ex VAT) and summed. Officer pay (`paidAmount`),
 *     subcontractor cost (`partnerChargeToUsAmount`), margin, and rate cards
 *     are NEVER selected here.
 *   - Officer identity is never returned in lists — the client sees that work
 *     was done, not who did it. An activity's own page shows the officer's
 *     report as filed (lib/clientReports.ts keeps only the answers, photos
 *     and signature).
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
import { ukDayString } from "@/lib/dates";

export type ClientActivityStatus = "Completed" | "In progress" | "Scheduled";

/** The kinds of work a client can filter the activity log by. */
export type ActivityGroup = "callout" | "lock" | "guarding" | "patrol" | "other";

export const ACTIVITY_GROUPS: { key: ActivityGroup; label: string }[] = [
  { key: "callout", label: "Callouts" },
  { key: "lock", label: "Lock-ups & unlocks" },
  { key: "guarding", label: "Static guarding" },
  { key: "patrol", label: "Patrols & inspections" },
  { key: "other", label: "Other" },
];

export function isActivityGroup(s: string | null | undefined): s is ActivityGroup {
  return ACTIVITY_GROUPS.some((g) => g.key === s);
}

export function jobGroup(type: string): ActivityGroup {
  switch (type) {
    case "ALARM_RESPONSE":
    case "ADHOC":
      return "callout";
    case "LOCK":
    case "UNLOCK":
      return "lock";
    case "STATIC_GUARDING_SHIFT":
    case "DOG_HANDLER_SHIFT":
      return "guarding";
    case "PATROL":
    case "VPI":
      return "patrol";
    default:
      return "other";
  }
}

export type ClientActivity = {
  id: string;
  /** The activity's own page (its report). */
  href: string;
  kind: string;
  group: ActivityGroup;
  siteId: string;
  siteName: string;
  siteCode: string | null;
  at: Date;
  status: ClientActivityStatus;
  /** What we charged for it, ex VAT; null until it's priced. */
  charge: number | null;
  /** An officer's report, photos or check-ins are on its page. */
  hasReport: boolean;
};

/** Internal shape — `billed` is the charge with nulls as 0, for sums. */
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

/**
 * Client-facing label for a job's kind. Static-guarding and dog-handler work
 * can reach the portal as a Job (type STATIC_GUARDING_SHIFT / DOG_HANDLER_SHIFT)
 * or as a Shift, and both must read as the same activity — otherwise the client
 * sees "Static guarding" and "Static guarding shift" as two separate types. So
 * these two job types are forced to the same canonical labels the Shift path
 * uses, ignoring any per-job typeLabel.
 */
export function jobKindLabel(type: string, typeLabel: string | null): string {
  if (type === "STATIC_GUARDING_SHIFT") return "Static guarding";
  if (type === "DOG_HANDLER_SHIFT") return "Dog handler";
  return typeLabel ?? JOB_KIND[type] ?? type.replace(/_/g, " ");
}

export function jobStatus(s: string): ClientActivityStatus {
  if (s === "IN_PROGRESS") return "In progress";
  if (s === "OPEN" || s === "ASSIGNED") return "Scheduled";
  return "Completed"; // SUBMITTED / REVIEW_PENDING / APPROVED / SENT_TO_CLIENT / CLOSED
}
export function pendingStatus(s: string): ClientActivityStatus {
  if (s === "IN_PROGRESS") return "In progress";
  if (s === "COMPLETED") return "Completed";
  return "Scheduled"; // PENDING
}

function num(d: unknown): number {
  if (d == null) return 0;
  const n = Number(d as any);
  return Number.isFinite(n) ? n : 0;
}

function money(d: unknown): number | null {
  if (d == null) return null;
  const n = Number(d as any);
  return Number.isFinite(n) ? n : null;
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
        _count: { select: { formSubmissions: true } },
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
        photoUrls: true,
        patrolSchedule: { select: { kind: true } },
        site: { select: { id: true, name: true, code: true } },
        _count: { select: { formSubmissions: true } },
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
        _count: { select: { formSubmissions: true, fastfieldReports: true } },
      },
    }),
  ]);

  const out: RawActivity[] = [];

  for (const j of jobs) {
    if (!j.site) continue;
    out.push({
      id: `job:${j.id}`,
      href: `/client/activities/job/${j.id}`,
      kind: jobKindLabel(j.type, j.typeLabel),
      group: jobGroup(j.type),
      siteId: j.site.id,
      siteName: j.site.name,
      siteCode: j.site.code,
      at: jobWhen(j) ?? j.createdAt ?? to,
      status: jobStatus(j.status),
      charge: money(j.billedAmount),
      hasReport: j._count.formSubmissions > 0,
      billed: num(j.billedAmount),
    });
  }
  for (const v of visits) {
    if (!v.site) continue;
    out.push({
      id: `visit:${v.id}`,
      href: `/client/activities/visit/${v.id}`,
      kind: v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol",
      group: "patrol",
      siteId: v.site.id,
      siteName: v.site.name,
      siteCode: v.site.code,
      at: visitWhen(v),
      status: pendingStatus(v.status),
      charge: money(v.billedAmount),
      hasReport: v._count.formSubmissions > 0 || v.photoUrls.length > 0,
      billed: num(v.billedAmount),
    });
  }
  for (const s of shifts) {
    if (!s.site) continue;
    out.push({
      id: `shift:${s.id}`,
      href: `/client/activities/shift/${s.id}`,
      kind: s.type === "DOG_HANDLER" ? "Dog handler" : "Static guarding",
      group: "guarding",
      siteId: s.site.id,
      siteName: s.site.name,
      siteCode: s.site.code,
      at: shiftWhen(s),
      status: pendingStatus(s.status),
      charge: money(s.billedAmount),
      hasReport: s._count.formSubmissions + s._count.fastfieldReports > 0,
      billed: num(s.billedAmount),
    });
  }

  return out;
}

// ── Pure aggregation (unit-tested) ────────────────────────────────────────

export type Bucket = "day" | "week" | "month";

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
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const DAYMONTH_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
});

function ymdToNoonUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Bucket key for a date — day / week (its Monday) / month — in UK time. */
export function periodKey(d: Date, bucket: Bucket): string {
  if (bucket === "month") return MONTH_KEY_FMT.format(d).slice(0, 7);
  const ymd = ukDayString(d); // "YYYY-MM-DD" in UK terms
  if (bucket === "day") return ymd;
  const [y, m, day] = ymd.split("-").map(Number);
  const noon = Date.UTC(y, m - 1, day, 12);
  const dow = new Date(noon).getUTCDay(); // 0=Sun … 6=Sat
  const monday = new Date(noon - ((dow + 6) % 7) * 86_400_000);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
}

/** Human label for a bucket key at the given granularity. */
export function periodLabel(key: string, bucket: Bucket): string {
  if (bucket === "month") {
    const [y, m] = key.split("-").map(Number);
    return MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 15, 12)));
  }
  const dt = ymdToNoonUtc(key);
  return bucket === "day" ? DAY_FMT.format(dt) : DAYMONTH_FMT.format(dt);
}

/** Inclusive list of bucket keys spanning [from, to] at the given granularity. */
export function periodKeysBetween(from: Date, to: Date, bucket: Bucket): string[] {
  const keys: string[] = [];
  const endKey = periodKey(to, bucket);
  if (bucket === "month") {
    let y = from.getUTCFullYear();
    let mo = from.getUTCMonth();
    for (let i = 0; i < 24; i++) {
      const k = `${y}-${String(mo + 1).padStart(2, "0")}`;
      keys.push(k);
      if (k === endKey) break;
      mo++;
      if (mo > 11) {
        mo = 0;
        y++;
      }
    }
    return keys;
  }
  const step = bucket === "week" ? 7 : 1;
  const cap = bucket === "week" ? 30 : 62;
  let cursor = ymdToNoonUtc(periodKey(from, bucket));
  for (let i = 0; i < cap; i++) {
    const k = periodKey(cursor, bucket);
    keys.push(k);
    if (k === endKey) break;
    cursor = new Date(cursor.getTime() + step * 86_400_000);
  }
  if (keys[keys.length - 1] !== endKey) keys.push(endKey);
  return keys;
}

export type ClientSummary = {
  totalActivities: number;
  totalSpend: number;
  byKind: { label: string; count: number }[];
  spendBySite: { siteId: string; siteName: string; amount: number }[];
  activityByPeriod: { key: string; label: string; count: number }[];
  spendByPeriod: { key: string; label: string; amount: number }[];
};

/** Roll a set of raw activities into the portal's KPIs, breakdowns and trends. */
export function summariseClientActivities(
  rows: Pick<RawActivity, "kind" | "siteId" | "siteName" | "at" | "billed">[],
  periodKeys: string[],
  bucket: Bucket,
): ClientSummary {
  const byKind = new Map<string, number>();
  const bySite = new Map<string, { siteName: string; amount: number }>();
  const actByPeriod = new Map<string, number>();
  const spendByPeriod = new Map<string, number>();
  let totalSpend = 0;

  for (const k of periodKeys) {
    actByPeriod.set(k, 0);
    spendByPeriod.set(k, 0);
  }

  for (const r of rows) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    const site = bySite.get(r.siteId) ?? { siteName: r.siteName, amount: 0 };
    site.amount += r.billed;
    bySite.set(r.siteId, site);
    totalSpend += r.billed;
    const pk = periodKey(r.at, bucket);
    if (actByPeriod.has(pk)) actByPeriod.set(pk, (actByPeriod.get(pk) ?? 0) + 1);
    if (spendByPeriod.has(pk))
      spendByPeriod.set(pk, (spendByPeriod.get(pk) ?? 0) + r.billed);
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
    activityByPeriod: periodKeys.map((key) => ({
      key,
      label: periodLabel(key, bucket),
      count: actByPeriod.get(key) ?? 0,
    })),
    spendByPeriod: periodKeys.map((key) => ({
      key,
      label: periodLabel(key, bucket),
      amount: spendByPeriod.get(key) ?? 0,
    })),
  };
}

// ── Public loaders ────────────────────────────────────────────────────────

/** Recent client-visible activities (no officer identity), newest first. */
export async function loadClientActivities(
  customerId: string,
  opts: {
    from: Date;
    to: Date;
    siteId?: string | null;
    group?: ActivityGroup | null;
    limit?: number;
  },
): Promise<ClientActivity[]> {
  let rows = await fetchRaw(customerId, opts.from, opts.to, opts.siteId);
  if (opts.group) rows = rows.filter((r) => r.group === opts.group);
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
  opts: { from: Date; to: Date; bucket: Bucket; siteId?: string | null },
): Promise<ClientOverview> {
  const [rows, siteCount] = await Promise.all([
    fetchRaw(customerId, opts.from, opts.to, opts.siteId),
    prisma.site.count({ where: { customerId } }),
  ]);
  const summary = summariseClientActivities(
    rows,
    periodKeysBetween(opts.from, opts.to, opts.bucket),
    opts.bucket,
  );
  const recent = [...rows]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8)
    .map(({ billed: _billed, ...rest }) => rest);
  return { ...summary, siteCount, recent };
}

// ── Invoices ──────────────────────────────────────────────────────────────

export type ClientInvoiceState = "Paid" | "Overdue" | "Unpaid";

/** What's still owed on an invoice and how to describe it — the same sum as
 *  Finance → Receivables (payments and issued credit notes come off). */
export function invoiceState(
  inv: { status: string; total: number; paid: number; credited: number; dueAt: Date | null },
  now: Date,
): { balance: number; state: ClientInvoiceState } {
  const balance = Math.max(0, Math.round((inv.total - inv.paid - inv.credited) * 100) / 100);
  if (inv.status === "PAID" || balance <= 0.009) return { balance: 0, state: "Paid" };
  if (inv.dueAt && inv.dueAt.getTime() < now.getTime()) return { balance, state: "Overdue" };
  return { balance, state: "Unpaid" };
}

export type ClientInvoice = {
  id: string;
  number: string;
  periodFrom: Date;
  periodTo: Date;
  issuedAt: Date | null;
  dueAt: Date | null;
  /** Including VAT. */
  total: number;
  balance: number;
  state: ClientInvoiceState;
};

/** The customer's sent invoices (never drafts or voids), newest first. */
export async function loadClientInvoices(customerId: string): Promise<ClientInvoice[]> {
  const rows = await prisma.invoice.findMany({
    where: { customerId, status: { in: ["SENT", "PAID"] } },
    orderBy: [{ issuedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      status: true,
      periodFrom: true,
      periodTo: true,
      issuedAt: true,
      dueAt: true,
      total: true,
      payments: { select: { amount: true } },
      creditNotes: { where: { status: "ISSUED" }, select: { total: true } },
    },
  });
  const now = new Date();
  return rows.map((r) => {
    const total = num(r.total);
    const { balance, state } = invoiceState(
      {
        status: r.status,
        total,
        paid: r.payments.reduce((n, p) => n + num(p.amount), 0),
        credited: r.creditNotes.reduce((n, c) => n + num(c.total), 0),
        dueAt: r.dueAt,
      },
      now,
    );
    return {
      id: r.id,
      number: r.number,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      issuedAt: r.issuedAt,
      dueAt: r.dueAt,
      total,
      balance,
      state,
    };
  });
}
