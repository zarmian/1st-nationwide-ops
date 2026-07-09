import Link from "next/link";
import type { Prisma, JobStatus } from "@prisma/client";
import { CalendarPlus, History } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { BarList } from "@/components/BarList";
import { TrendChart } from "@/components/TrendChart";
import { CancelActivityButton } from "./_components/CancelActivityButton";
import { CloseActivityButton } from "./_components/CloseActivityButton";
import { ReassignOfficer } from "./_components/ReassignOfficer";
import { EditIconLink } from "./_components/EditIconLink";
import { ActivityCard } from "./_components/ActivityCard";
import { DispatchMap } from "./_components/DispatchMap";
import { SyncSchedulesButton } from "./_components/SyncSchedulesButton";
import { MapLayerToggles } from "./_components/MapLayerToggles";
import { AutoRefresh } from "../m/today/_components/AutoRefresh";
import type {
  OfficerPin,
  SitePin,
  AssignmentLine,
  Freshness,
} from "@/components/map/MapInner";
import { siteOwner } from "@/lib/entityColor";
import { daysFromTodayUk, ukDayPlus, ukWallClockToUtc } from "@/lib/dates";
import { getJobSourceLabels, getJobTypeLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

const LIVE_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
] satisfies JobStatus[];

const COMPLETED_STATUSES = [
  "APPROVED",
  "SENT_TO_CLIENT",
  "CLOSED",
] satisfies JobStatus[];

const BUCKETS = [
  "pending",
  "in_progress",
  "review",
  "missed",
  "completed",
  "cancelled",
] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketWhere(bucket: Bucket | null, now: Date): Prisma.JobWhereInput {
  switch (bucket) {
    case "pending":
      return { status: { in: ["OPEN", "ASSIGNED"] } };
    case "in_progress":
      return { status: "IN_PROGRESS" };
    case "review":
      return { status: { in: ["SUBMITTED", "REVIEW_PENDING"] } };
    case "missed":
      return {
        status: { in: ["OPEN", "ASSIGNED"] },
        scheduledFor: { lt: now },
      };
    case "completed":
      return { status: { in: COMPLETED_STATUSES as JobStatus[] } };
    case "cancelled":
      return { status: "CANCELLED" };
    default:
      // No bucket selected = "live work in progress".
      return { status: { in: LIVE_STATUSES as JobStatus[] } };
  }
}

/**
 * PatrolVisit equivalent of bucketWhere — keeps the dispatch board's
 * filters meaningful for visits even though VisitStatus has a different
 * vocabulary than JobStatus. Returns null for buckets that don't apply
 * to visits (review queue is a Job-only concept, visits don't cancel),
 * so the caller can skip the query entirely.
 */
function emptyUuid() {
  // Tautologically-empty id filter: lets count queries skip a bucket
  // without conditional Promise.all branches.
  return "00000000-0000-0000-0000-000000000000";
}

function priorityRank(p: string): number {
  return p === "HIGH" ? 0 : p === "MEDIUM" ? 1 : 2;
}

function visitBucketWhere(
  bucket: Bucket | null,
  now: Date,
): Prisma.PatrolVisitWhereInput | null {
  switch (bucket) {
    case "pending":
      return { status: "PENDING" };
    case "in_progress":
      return { status: { in: ["IN_PROGRESS", "LATE"] } };
    case "review":
      return null;
    case "missed":
      return {
        OR: [
          { status: "MISSED" },
          { status: "PENDING", scheduledAt: { lt: now } },
        ],
      };
    case "completed":
      return { status: "COMPLETED" };
    case "cancelled":
      return null;
    default:
      return { status: { in: ["PENDING", "IN_PROGRESS", "LATE"] } };
  }
}

const VALID_LAYERS = ["jobs", "sites", "lines"] as const;
type LayerKey = (typeof VALID_LAYERS)[number];

function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const ms = Date.now() - date.getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
}

/**
 * "Today · 14:30", "Tomorrow · 09:00", "Mon 19 May · 14:30",
 * "Yesterday · 22:15", or the long form for far-out dates.
 */
function formatScheduled(date: Date | null | undefined): {
  day: string;
  time: string;
} | null {
  if (!date) return null;
  const diffDays = daysFromTodayUk(date);

  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });

  let day: string;
  if (diffDays === 0) day = "Today";
  else if (diffDays === 1) day = "Tomorrow";
  else if (diffDays === -1) day = "Yesterday";
  else
    day = date.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  return { day, time };
}

function freshnessOf(lastSeenAt: Date | null): Freshness {
  if (!lastSeenAt) return "old";
  const mins = (Date.now() - lastSeenAt.getTime()) / 60000;
  if (mins < 5) return "fresh";
  if (mins < 15) return "stale";
  return "old";
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: { bucket?: string; layers?: string };
}) {
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === "ADMIN";

  const now = new Date();
  const bucket: Bucket | null =
    searchParams.bucket && (BUCKETS as readonly string[]).includes(searchParams.bucket)
      ? (searchParams.bucket as Bucket)
      : null;

  // Default the map to show jobs + all sites unless the user has explicitly
  // turned them off. The empty string `"layers="` in the URL means
  // "everything off"; absent means "use defaults".
  const activeLayers = new Set<LayerKey>(
    searchParams.layers === undefined
      ? (["jobs", "sites"] satisfies LayerKey[])
      : searchParams.layers
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is LayerKey =>
            (VALID_LAYERS as readonly string[]).includes(s),
          ),
  );

  const jobsWhere = bucketWhere(bucket, now);
  const visitsWhere = visitBucketWhere(bucket, now);

  // Recent-activity feed cutoff: midnight UK two days ago so the table
  // shows today + the previous two calendar days of completed work.
  const recentCutoffUk = ukDayPlus(now, -2);
  const recentSince = ukWallClockToUtc(
    recentCutoffUk.year,
    recentCutoffUk.month,
    recentCutoffUk.day,
    0,
    0,
    0,
  );
  // Analytics windows: start of today (UK) for the "today" stat strip, and
  // 7 days back for the activity-mix breakdown.
  const todayUk = ukDayPlus(now, 0);
  const startOfTodayUtc = ukWallClockToUtc(
    todayUk.year,
    todayUk.month,
    todayUk.day,
    0,
    0,
    0,
  );
  const weekCutoffUk = ukDayPlus(now, -6);
  const weekSince = ukWallClockToUtc(
    weekCutoffUk.year,
    weekCutoffUk.month,
    weekCutoffUk.day,
    0,
    0,
    0,
  );
  // Every bucket sorts by scheduled time first. The dispatcher's
  // mental model is the day's schedule (07:00 unlock → 09:00 VPI →
  // 22:00 lock-up), not the order paperwork closed in. For the
  // completed / cancelled buckets we still want most-recent-first,
  // but anchored on when the work was meant to happen.
  const jobsOrderBy: Prisma.JobOrderByWithRelationInput[] =
    bucket === "completed" || bucket === "cancelled"
      ? [{ scheduledFor: "desc" }, { createdAt: "desc" }]
      : [{ priority: "asc" }, { scheduledFor: "asc" }, { createdAt: "desc" }];
  const visitsOrderBy: Prisma.PatrolVisitOrderByWithRelationInput[] =
    bucket === "completed"
      ? [{ scheduledAt: "desc" }]
      : [{ scheduledAt: "asc" }];

  const [
    jobs,
    visits,
    onDutyOfficers,
    pendingCount,
    inProgressCount,
    reviewCount,
    missedCount,
    completedCount,
    cancelledCount,
    pendingVisitCount,
    inProgressVisitCount,
    missedVisitCount,
    completedVisitCount,
    assignableOfficers,
    allActiveSites,
    jobTypeLabels,
    jobSourceLabels,
    recentJobs,
    recentVisits,
    weekJobs,
    weekVisits,
    liveByRegion,
    dailyActivityRows,
  ] = await Promise.all([
    prisma.job.findMany({
      where: jobsWhere,
      include: {
        site: {
          select: {
            id: true,
            name: true,
            postcode: true,
            postcodeFormatted: true,
            lat: true,
            lng: true,
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        },
        customer: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
        partner: { select: { name: true } },
        handledByPartner: { select: { id: true, name: true } },
      },
      orderBy: jobsOrderBy,
      take: 100,
    }),
    // PatrolVisits join the dispatch board too — every activity in one
    // place. Skipped (resolves to []) for the buckets that don't apply
    // to visits (review / cancelled).
    visitsWhere
      ? prisma.patrolVisit.findMany({
          where: visitsWhere,
          include: {
            site: {
              select: {
                id: true,
                name: true,
                postcode: true,
                postcodeFormatted: true,
                lat: true,
                lng: true,
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { id: true, name: true } },
            patrolSchedule: { select: { kind: true } },
          },
          orderBy: visitsOrderBy,
          take: 100,
        })
      : Promise.resolve(
          [] as Array<{
            id: string;
            scheduledAt: Date;
            arrivedAt: Date | null;
            departedAt: Date | null;
            status: string;
            notes: string | null;
            billedAmount: any;
            paidAmount: any;
            site: {
              id: string;
              name: string;
              postcode: string | null;
              postcodeFormatted: string;
              lat: number | null;
              lng: number | null;
              customer: { name: string } | null;
              partner: { name: string } | null;
            };
            officer: { id: string; name: string } | null;
            patrolSchedule: { kind: string } | null;
          }>,
        ),
    prisma.user.findMany({
      where: {
        active: true,
        onDuty: true,
        role: { in: ["OFFICER", "DISPATCHER"] },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        lastLat: true,
        lastLng: true,
        lastSeenAt: true,
      },
    }),
    prisma.job.count({ where: bucketWhere("pending", now) }),
    prisma.job.count({ where: bucketWhere("in_progress", now) }),
    prisma.job.count({ where: bucketWhere("review", now) }),
    prisma.job.count({ where: bucketWhere("missed", now) }),
    prisma.job.count({ where: bucketWhere("completed", now) }),
    prisma.job.count({ where: bucketWhere("cancelled", now) }),
    prisma.patrolVisit.count({
      where: visitBucketWhere("pending", now) ?? { id: emptyUuid() },
    }),
    prisma.patrolVisit.count({
      where: visitBucketWhere("in_progress", now) ?? { id: emptyUuid() },
    }),
    prisma.patrolVisit.count({
      where: visitBucketWhere("missed", now) ?? { id: emptyUuid() },
    }),
    prisma.patrolVisit.count({
      where: visitBucketWhere("completed", now) ?? { id: emptyUuid() },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Only hit the DB when the "All active sites" overlay is on — this can
    // be 400+ rows once the importer runs.
    activeLayers.has("sites")
      ? prisma.site.findMany({
          where: { active: true, lat: { not: null }, lng: { not: null } },
          select: {
            id: true,
            name: true,
            postcodeFormatted: true,
            lat: true,
            lng: true,
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string;
            name: string;
            postcodeFormatted: string;
            lat: number | null;
            lng: number | null;
            customer: { name: string } | null;
            partner: { name: string } | null;
          }>,
        ),
    getJobTypeLabels(),
    getJobSourceLabels(),
    prisma.job.findMany({
      where: { completedAt: { gte: recentSince, lte: now } },
      include: {
        site: { select: { id: true, name: true } },
        assignedTo: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      orderBy: { completedAt: "desc" },
      take: 100,
    }),
    prisma.patrolVisit.findMany({
      where: { departedAt: { gte: recentSince, lte: now } },
      include: {
        site: { select: { id: true, name: true } },
        officer: { select: { name: true } },
        patrolSchedule: { select: { kind: true } },
      },
      orderBy: { departedAt: "desc" },
      take: 100,
    }),
    // ── Analytics: last-7-day completed jobs (type mix + response time) ──
    prisma.job.findMany({
      where: { completedAt: { gte: weekSince, lte: now }, status: { not: "CANCELLED" } },
      select: { type: true, scheduledFor: true, startedAt: true, completedAt: true },
      take: 2000,
    }),
    // Last-7-day completed visits (type mix).
    prisma.patrolVisit.findMany({
      where: { status: "COMPLETED", departedAt: { gte: weekSince, lte: now } },
      select: { patrolSchedule: { select: { kind: true } } },
      take: 2000,
    }),
    // Live workload (open / assigned / in-progress) by region — what's on
    // the board right now, grouped to show where the pressure is.
    prisma.job.findMany({
      where: { status: { in: LIVE_STATUSES as JobStatus[] } },
      select: { site: { select: { region: { select: { name: true } } } } },
      take: 2000,
    }),
    // 14-day activity volume (completed jobs + visits per UK day).
    prisma.$queryRaw<{ day: Date; total: number }[]>`
      SELECT day, COUNT(*)::float8 AS total
      FROM (
        SELECT date_trunc('day', "completedAt") AS day FROM "Job"
        WHERE "completedAt" >= ${ukWallClockToUtc(ukDayPlus(now, -13).year, ukDayPlus(now, -13).month, ukDayPlus(now, -13).day, 0, 0, 0)}
          AND "completedAt" <= ${now} AND "status" <> 'CANCELLED'
        UNION ALL
        SELECT date_trunc('day', "departedAt") AS day FROM "PatrolVisit"
        WHERE "departedAt" >= ${ukWallClockToUtc(ukDayPlus(now, -13).year, ukDayPlus(now, -13).month, ukDayPlus(now, -13).day, 0, 0, 0)}
          AND "departedAt" <= ${now} AND "status" = 'COMPLETED'
      ) s
      GROUP BY day ORDER BY day ASC
    `,
  ]);

  const bucketCounts: Record<Bucket, number> = {
    pending: pendingCount + pendingVisitCount,
    in_progress: inProgressCount + inProgressVisitCount,
    review: reviewCount,
    missed: missedCount + missedVisitCount,
    completed: completedCount + completedVisitCount,
    cancelled: cancelledCount,
  };

  // Merge Jobs and PatrolVisits into a single rows[] for the board. To
  // the user "every activity is a job," so a recurring VPI / patrol visit
  // shows alongside lock-ups and ad-hoc callouts. We discriminate via
  // __visitId — null for real Jobs, the visit id for projected visits —
  // so the cells can route edit/cancel/reassign to the right model.
  type DispatchRow = {
    __visitId: string | null;
    id: string;
    type: string;
    source: string;
    status: string;
    priority: string;
    scheduledFor: Date | null;
    site: {
      id: string;
      name: string;
      postcode: string | null;
      postcodeFormatted: string;
      lat: number | null;
      lng: number | null;
      customer: { name: string } | null;
      partner: { name: string } | null;
    } | null;
    customer: { name: string } | null;
    partner: { name: string } | null;
    assignedTo: { id: string; name: string } | null;
    handledByPartner: { id: string; name: string } | null;
  };

  const jobRows: DispatchRow[] = jobs.map((j) => ({
    __visitId: null,
    id: j.id,
    type: j.type,
    source: j.source,
    status: j.status,
    priority: j.priority,
    scheduledFor: j.scheduledFor,
    site: j.site,
    customer: j.customer,
    partner: j.partner,
    assignedTo: j.assignedTo,
    handledByPartner: j.handledByPartner,
  }));

  const visitRows: DispatchRow[] = visits.map((v) => ({
    __visitId: v.id,
    id: v.id,
    type: v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL",
    source: "SCHEDULED",
    status: v.status,
    priority: "MEDIUM",
    scheduledFor: v.scheduledAt,
    site: v.site,
    customer: v.site?.customer ?? null,
    partner: v.site?.partner ?? null,
    assignedTo: v.officer,
    handledByPartner: null,
  }));

  const rows: DispatchRow[] = [...jobRows, ...visitRows].sort((a, b) => {
    // Mirror the Job ordering: priority HIGH first, then earliest scheduled.
    // Priority on visits is always MEDIUM, so visits interleave by time.
    const pri = priorityRank(a.priority) - priorityRank(b.priority);
    if (pri !== 0) return pri;
    const at = a.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY;
    return at - bt;
  });
  const bucketLabels: Record<Bucket, string> = {
    pending: "Pending",
    in_progress: "In progress",
    review: "Awaiting review",
    missed: "Missed",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  // --- Recent activity feed (last ~2 days of completed work) ----------------
  type RecentRow = {
    id: string;
    href: string;
    at: Date;
    typeLabel: string;
    siteId: string | null;
    siteName: string | null;
    officerName: string | null;
  };
  const recentRows: RecentRow[] = [];
  for (const j of recentJobs) {
    if (!j.completedAt) continue;
    recentRows.push({
      id: `j:${j.id}`,
      href: `/dispatch/${j.id}`,
      at: j.completedAt,
      typeLabel: jobTypeLabels[j.type] ?? j.type.replace(/_/g, " "),
      siteId: j.site?.id ?? null,
      siteName: j.site?.name ?? null,
      officerName: j.handledByPartner
        ? `${j.handledByPartner.name} (partner)`
        : (j.assignedTo?.name ?? null),
    });
  }
  for (const v of recentVisits) {
    if (!v.departedAt) continue;
    recentRows.push({
      id: `v:${v.id}`,
      href: `/patrols/visits/${v.id}`,
      at: v.departedAt,
      typeLabel: v.patrolSchedule?.kind === "VPI" ? "VPI visit" : "Patrol visit",
      siteId: v.site?.id ?? null,
      siteName: v.site?.name ?? null,
      officerName: v.officer?.name ?? null,
    });
  }
  recentRows.sort((a, b) => b.at.getTime() - a.at.getTime());
  const recentLimited = recentRows.slice(0, 50);

  function fmtRecent(d: Date): { day: string; time: string } {
    const diff = daysFromTodayUk(d, now);
    const day =
      diff === 0
        ? "Today"
        : diff === -1
          ? "Yesterday"
          : d.toLocaleDateString("en-GB", {
              timeZone: "Europe/London",
              weekday: "short",
              day: "2-digit",
              month: "short",
            });
    const time = d.toLocaleTimeString("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
    });
    return { day, time };
  }

  // --- Operations analytics derivation --------------------------------------
  // Completed today (UK) across jobs + visits.
  const completedTodayJobs = weekJobs.filter(
    (j) => j.completedAt && j.completedAt >= startOfTodayUtc,
  ).length;
  const completedTodayVisits = recentVisits.filter(
    (v) => v.departedAt && v.departedAt >= startOfTodayUtc,
  ).length;
  const completedTodayTotal = completedTodayJobs + completedTodayVisits;

  // Avg response time today: minutes between scheduledFor and startedAt for
  // jobs that actually started, where the officer wasn't early. Directional.
  const responseSamples = weekJobs
    .filter(
      (j) =>
        j.startedAt &&
        j.scheduledFor &&
        j.startedAt >= startOfTodayUtc &&
        j.startedAt.getTime() - j.scheduledFor.getTime() > 0,
    )
    .map((j) => (j.startedAt!.getTime() - j.scheduledFor!.getTime()) / 60000);
  const avgResponseMins =
    responseSamples.length > 0
      ? Math.round(
          responseSamples.reduce((a, b) => a + b, 0) / responseSamples.length,
        )
      : null;

  // Completion rate today: completed ÷ (completed + still-overdue) so the
  // dispatcher sees how much of today's expected work is closed out.
  const overdueNow = bucketCounts.missed;
  const completionRate =
    completedTodayTotal + overdueNow > 0
      ? Math.round((completedTodayTotal / (completedTodayTotal + overdueNow)) * 100)
      : null;

  // Activity mix (last 7 days) by service type.
  const typeCount = new Map<string, number>();
  for (const j of weekJobs) {
    const label = jobTypeLabels[j.type] ?? j.type.replace(/_/g, " ");
    typeCount.set(label, (typeCount.get(label) ?? 0) + 1);
  }
  for (const v of weekVisits) {
    const label = v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol";
    typeCount.set(label, (typeCount.get(label) ?? 0) + 1);
  }
  const activityByType = Array.from(typeCount.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Live workload by region.
  const regionCount = new Map<string, number>();
  for (const j of liveByRegion) {
    const name = j.site?.region?.name ?? "No region";
    regionCount.set(name, (regionCount.get(name) ?? 0) + 1);
  }
  const workloadByRegion = Array.from(regionCount.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // 14-day activity volume series + labels (densified, gaps → 0).
  const activityDayMap = new Map<string, number>();
  for (const r of dailyActivityRows) {
    const d = new Date(r.day);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    activityDayMap.set(key, Number(r.total) || 0);
  }
  const activityVolume: number[] = [];
  const activityLabels: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const dParts = ukDayPlus(now, -i);
    const d = new Date(dParts.year, dParts.month - 1, dParts.day);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    activityVolume.push(activityDayMap.get(key) ?? 0);
    activityLabels.push(
      d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    );
  }
  const activity14dTotal = activityVolume.reduce((a, b) => a + b, 0);

  // --- Map data derivation ---------------------------------------------------

  const officerPins: OfficerPin[] = onDutyOfficers
    .filter(
      (o): o is typeof o & { lastLat: number; lastLng: number } =>
        typeof o.lastLat === "number" && typeof o.lastLng === "number",
    )
    .map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      lat: o.lastLat,
      lng: o.lastLng,
      freshness: freshnessOf(o.lastSeenAt),
      lastSeenLabel: relativeTime(o.lastSeenAt),
    }));

  // Sites with at least one live job — derived from `jobs` already fetched,
  // so no extra DB call.
  const jobSitesMap = new Map<string, SitePin>();
  for (const j of jobs) {
    const s = j.site;
    if (!s || typeof s.lat !== "number" || typeof s.lng !== "number") continue;
    const existing = jobSitesMap.get(s.id);
    if (existing) {
      existing.liveJobCount = (existing.liveJobCount ?? 0) + 1;
    } else {
      const owner = siteOwner(s);
      jobSitesMap.set(s.id, {
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        postcode: s.postcodeFormatted,
        liveJobCount: 1,
        colorHex: owner.hex,
        ownerKey: owner.key,
        ownerLabel: owner.label,
      });
    }
  }
  const jobSites: SitePin[] = Array.from(jobSitesMap.values());

  const allSites: SitePin[] = allActiveSites
    .filter(
      (s): s is typeof s & { lat: number; lng: number } =>
        typeof s.lat === "number" && typeof s.lng === "number",
    )
    .map((s) => {
      const owner = siteOwner(s);
      return {
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        postcode: s.postcodeFormatted,
        colorHex: owner.hex,
        ownerKey: owner.key,
        ownerLabel: owner.label,
      };
    });

  // For each on-duty officer with GPS, draw a line to their next assigned
  // live-job site (earliest scheduledFor, NULLs last).
  const lines: AssignmentLine[] = [];
  if (activeLayers.has("lines")) {
    for (const o of officerPins) {
      const myJobs = jobs
        .filter((j) => j.assignedTo?.id === o.id && j.site?.lat != null && j.site?.lng != null)
        .sort((a, b) => {
          const at = a.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY;
          const bt = b.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY;
          return at - bt;
        });
      const next = myJobs[0];
      if (!next || !next.site) continue;
      lines.push({
        officerId: o.id,
        fromLat: o.lat,
        fromLng: o.lng,
        toLat: next.site.lat as number,
        toLng: next.site.lng as number,
        officerName: o.name,
        siteName: next.site.name,
      });
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dispatch"
        subtitle="Live jobs across all sites"
        actions={
          <>
            <SyncSchedulesButton />
            <Link
              href="/dispatch/callouts/new"
              className="btn-secondary text-left"
              title="Log a callout that's already been handled"
            >
              <History size={16} className="shrink-0" />
              <span className="leading-tight">
                <span className="block">Record callout</span>
                <span className="block text-[10px] font-normal opacity-70">
                  Log a past activity
                </span>
              </span>
            </Link>
            <Link
              href="/dispatch/new"
              className="btn-primary text-left"
              title="Schedule a new job for the future"
            >
              <CalendarPlus size={16} className="shrink-0" />
              <span className="leading-tight">
                <span className="block">New job</span>
                <span className="block text-[10px] font-normal opacity-80">
                  Schedule for the future
                </span>
              </span>
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {BUCKETS.map((b) => {
          const isActive = bucket === b;
          const layersQs = activeLayers.size
            ? `&layers=${Array.from(activeLayers).join(",")}`
            : "";
          const href = isActive
            ? `/dispatch${activeLayers.size ? `?layers=${Array.from(activeLayers).join(",")}` : ""}`
            : `/dispatch?bucket=${b}${layersQs}`;
          const isMissed = b === "missed";
          const count = bucketCounts[b];
          const isAlert = isMissed && count > 0;
          // Filter-chip pattern from globals.css (.pill-idle / .pill-active)
          // with an extra red tone for the "missed" bucket when it has rows
          // — same dispatcher-attention treatment as before, just compact.
          const cls = isActive
            ? isAlert
              ? "pill bg-red-100 text-red-800 border-red-300"
              : "pill-active"
            : isAlert
              ? "pill bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
              : "pill-idle";
          return (
            <Link key={b} href={href} className={cls}>
              <span>{bucketLabels[b]}</span>
              <span className="tabular-nums text-[11px] opacity-80">
                {count.toLocaleString("en-GB")}
              </span>
            </Link>
          );
        })}
      </div>
      {bucket && (
        <div className="text-xs text-slate-500">
          Filtered to{" "}
          <span className="font-medium text-brand-navy">
            {bucketLabels[bucket]}
          </span>
          {" · "}
          <Link href="/dispatch" className="text-brand-blue-dark hover:underline">
            clear
          </Link>
        </div>
      )}

      {/* ── Operations analytics ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card-accent p-4 flex flex-col gap-1">
          <div className="kpi-label">Completed today</div>
          <div className="kpi-value">{completedTodayTotal.toLocaleString("en-GB")}</div>
          <div className="kpi-hint">jobs + visits closed</div>
        </div>
        <div className="kpi p-4">
          <div className="kpi-label">Completion rate</div>
          <div className="kpi-value">
            {completionRate == null ? "—" : `${completionRate}%`}
          </div>
          <div className="kpi-hint">
            {overdueNow > 0 ? `${overdueNow} overdue now` : "nothing overdue"}
          </div>
        </div>
        <div className="kpi p-4">
          <div className="kpi-label">Avg response today</div>
          <div className="kpi-value">
            {avgResponseMins == null ? "—" : `${avgResponseMins}m`}
          </div>
          <div className="kpi-hint">scheduled → on site</div>
        </div>
        <div className="kpi p-4">
          <div className="kpi-label">On duty now</div>
          <div className="kpi-value">{onDutyOfficers.length.toLocaleString("en-GB")}</div>
          <div className="kpi-hint">officers signed on</div>
        </div>
      </div>

      <AutoRefresh intervalMs={60_000} />

      {/* ── 3-column workspace ────────────────────────────────────────────
          LEFT  · upcoming work (filtered by bucket if chosen)
          MID   · live map + on-duty officers
          RIGHT · recently completed
          Below `lg` (1024px) the columns stack so phones / tablets see the
          same content in a single scroll. Each side column is height-
          capped + scrollable so the map dictates workspace height. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,300px)] items-start">
        {/* LEFT — Upcoming / bucket-filtered live work */}
        <div className="card overflow-hidden flex flex-col lg:max-h-[calc(100vh-220px)]">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-baseline justify-between gap-2">
            <h2 className="font-semibold text-brand-navy text-sm">
              {bucket ? bucketLabels[bucket] : "Upcoming"}
            </h2>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {rows.length.toLocaleString("en-GB")}
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <p className="empty-title text-sm">No live activities.</p>
              <Link
                href="/dispatch/new"
                className="btn-primary text-sm inline-flex"
              >
                + Create a job
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-y-auto">
              {rows.map((j) => {
                const isVisit = j.__visitId != null;
                const detailHref = isVisit
                  ? `/patrols/visits/${j.__visitId}`
                  : `/dispatch/${j.id}`;
                const editHref = isVisit
                  ? `/patrols/visits/${j.__visitId}/edit`
                  : `/dispatch/${j.id}/edit`;
                const canEdit = isAdmin && j.status !== "CANCELLED";
                const isClosed =
                  j.status === "APPROVED" ||
                  j.status === "SENT_TO_CLIENT" ||
                  j.status === "CLOSED" ||
                  j.status === "CANCELLED" ||
                  j.status === "COMPLETED";
                const canClose = !isClosed;
                const typeLabel =
                  jobTypeLabels[j.type] ?? j.type.replace(/_/g, " ");
                const activityLabel = `${typeLabel} @ ${j.site?.name ?? "site"}`;
                const f = formatScheduled(j.scheduledFor);
                const overdue =
                  j.scheduledFor != null &&
                  j.scheduledFor < now &&
                  (j.status === "OPEN" ||
                    j.status === "ASSIGNED" ||
                    j.status === "PENDING");
                const whenLabel = f ? `${f.day} ${f.time}` : null;
                const officerName = j.handledByPartner
                  ? `${j.handledByPartner.name} (partner)`
                  : (j.assignedTo?.name ?? null);
                // Reassign is offered on any still-live activity that isn't
                // handled in a partner's app (those have no internal officer
                // to swap).
                const canReassign = !isClosed && !j.handledByPartner;
                return (
                  <ActivityCard
                    key={j.id}
                    href={detailHref}
                    typeLabel={typeLabel}
                    whenLabel={whenLabel}
                    siteId={j.site?.id ?? null}
                    siteName={j.site?.name ?? null}
                    officerName={officerName}
                    status={j.status}
                    priority={j.priority as "HIGH" | "MEDIUM" | "LOW"}
                    overdue={overdue}
                    actions={
                      <>
                        {canReassign && (
                          <ReassignOfficer
                            kind={isVisit ? "visit" : "job"}
                            id={isVisit ? j.__visitId! : j.id}
                            currentOfficerId={j.assignedTo?.id ?? null}
                            officers={assignableOfficers}
                            size="small"
                          />
                        )}
                        {canEdit && (
                          <EditIconLink href={editHref} size="small" />
                        )}
                        {canClose && (
                          <CloseActivityButton
                            kind={isVisit ? "visit" : "job"}
                            id={isVisit ? j.__visitId! : j.id}
                            label={activityLabel}
                            size="small"
                          />
                        )}
                        {!isClosed && !j.handledByPartner && (
                          <CancelActivityButton
                            kind={isVisit ? "visit" : "job"}
                            id={isVisit ? j.__visitId! : j.id}
                            label={activityLabel}
                            size="small"
                          />
                        )}
                      </>
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>

        {/* MIDDLE — Live map + on-duty officers (compact, single col) */}
        <div className="space-y-3 min-w-0">
          <div className="card p-4 space-y-3">
            <div className="flex items-baseline justify-between flex-wrap gap-1">
              <h2 className="font-semibold text-brand-navy">Live map</h2>
              <p className="text-xs text-slate-500">
                {officerPins.length} officer{officerPins.length === 1 ? "" : "s"}
                {onDutyOfficers.length - officerPins.length > 0
                  ? ` (${onDutyOfficers.length - officerPins.length} without GPS)`
                  : ""}
                {" · "}
                {activeLayers.has("sites")
                  ? `${allSites.length} site${allSites.length === 1 ? "" : "s"}`
                  : activeLayers.has("jobs")
                    ? `${jobSites.length} job site${jobSites.length === 1 ? "" : "s"}`
                    : "no sites layer"}
              </p>
            </div>
            <MapLayerToggles active={activeLayers} />
            <DispatchMap
              officers={officerPins}
              jobSites={jobSites}
              allSites={allSites}
              lines={lines}
              layers={{
                jobSites: activeLayers.has("jobs"),
                allSites: activeLayers.has("sites"),
                lines: activeLayers.has("lines"),
              }}
            />
          </div>

          <div className="card p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-brand-navy text-sm">
                On duty ({onDutyOfficers.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                from <code className="text-[10px] bg-slate-100 px-1 rounded">/m/today</code>
              </p>
            </div>
            {onDutyOfficers.length === 0 ? (
              <p className="text-sm text-slate-500 italic">
                No one is on duty right now.
              </p>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-1.5">
                {onDutyOfficers.map((o) => {
                  const hasLoc =
                    typeof o.lastLat === "number" &&
                    typeof o.lastLng === "number";
                  return (
                    <li
                      key={o.id}
                      className="flex items-center justify-between border border-slate-200 rounded-lg px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/officers/${o.id}/edit`}
                          className="text-sm font-medium text-brand-navy hover:text-brand-blue-dark truncate block"
                        >
                          {o.name}
                        </Link>
                        <div className="text-[10px] text-slate-500">
                          {o.role.toLowerCase()} · {relativeTime(o.lastSeenAt)}
                        </div>
                      </div>
                      {hasLoc ? (
                        <a
                          href={`https://www.google.com/maps?q=${o.lastLat},${o.lastLng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="chip-mint text-[10px] shrink-0"
                        >
                          Map
                        </a>
                      ) : (
                        <span className="chip-slate text-[10px] shrink-0">
                          No GPS
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT — Recently completed */}
        <div className="card overflow-hidden flex flex-col lg:max-h-[calc(100vh-220px)]">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold text-brand-navy text-sm">
                Recently completed
              </h2>
              <p className="text-[11px] text-slate-500">last 2 days</p>
            </div>
            <Link
              href="/activities"
              className="text-[11px] text-brand-blue-dark hover:text-brand-navy underline shrink-0"
            >
              Full log →
            </Link>
          </div>
          {recentLimited.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              Nothing completed in the last two days.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-y-auto">
              {recentLimited.map((r) => {
                const { day, time } = fmtRecent(r.at);
                return (
                  <ActivityCard
                    key={r.id}
                    href={r.href}
                    typeLabel={r.typeLabel}
                    whenLabel={`${day} ${time}`}
                    siteId={r.siteId}
                    siteName={r.siteName}
                    officerName={r.officerName}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Analytics band (below the workspace) ─────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">
              Activity volume — last 14 days
            </h2>
            <p className="text-xs text-slate-500">
              Completed jobs + visits per day. Peak day labelled.
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-brand-navy tabular-nums leading-none">
              {activity14dTotal.toLocaleString("en-GB")}
            </div>
            <div className="text-[11px] text-slate-500">14-day total</div>
          </div>
        </div>
        <div className="p-4">
          <TrendChart
            values={activityVolume}
            labels={activityLabels}
            height={130}
            ariaLabel="Completed activities per day over the last 14 days"
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Activity mix</h2>
            <p className="text-xs text-slate-500">By service · last 7 days</p>
          </div>
          <BarList
            items={activityByType}
            emptyLabel="No completed activities in the last 7 days."
          />
        </div>
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              Live workload by region
            </h2>
            <p className="text-xs text-slate-500">
              Open + in-progress jobs right now
            </p>
          </div>
          <BarList
            tone="amber"
            items={workloadByRegion}
            emptyLabel="No live jobs on the board."
          />
        </div>
      </div>

    </div>
  );
}
