import Link from "next/link";
import type { Prisma, JobStatus } from "@prisma/client";
import { CalendarPlus, History } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { StatusDot } from "@/components/StatusDot";
import { DataTable } from "@/components/DataTable";
import { reassignJob } from "../patrols/_actions";
import { QuickReassignJob } from "../patrols/_components/QuickReassign";
import { CancelJobButton } from "./_components/CancelJobButton";
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Dispatch</h1>
          <p className="text-sm text-slate-500">Live jobs across all sites</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SyncSchedulesButton />
          <Link
            href="/dispatch/callouts/new"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:border-brand-navy hover:text-brand-navy transition text-left"
            title="Log a callout that's already been handled"
          >
            <History size={16} className="text-slate-500 shrink-0" />
            <span className="leading-tight">
              <span className="block text-sm font-medium text-brand-navy">
                Record callout
              </span>
              <span className="block text-[10px] text-slate-500">
                Log a past activity
              </span>
            </span>
          </Link>
          <Link
            href="/dispatch/new"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-blue text-white hover:bg-brand-blue-dark transition text-left shadow-card"
            title="Schedule a new job for the future"
          >
            <CalendarPlus size={16} className="text-white shrink-0" />
            <span className="leading-tight">
              <span className="block text-sm font-medium">
                New job
              </span>
              <span className="block text-[10px] text-white/80">
                Schedule for the future
              </span>
            </span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {BUCKETS.map((b) => {
          const isActive = bucket === b;
          const layersQs = activeLayers.size
            ? `&layers=${Array.from(activeLayers).join(",")}`
            : "";
          const href = isActive
            ? `/dispatch${activeLayers.size ? `?layers=${Array.from(activeLayers).join(",")}` : ""}`
            : `/dispatch?bucket=${b}${layersQs}`;
          const isMissed = b === "missed";
          const ring = isActive
            ? isMissed
              ? "ring-2 ring-red-300"
              : "ring-2 ring-brand-blue/40"
            : "";
          return (
            <Link
              key={b}
              href={href}
              className={`card p-3 hover:shadow-md transition-shadow ${ring}`}
            >
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                {bucketLabels[b]}
              </div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  isMissed && bucketCounts[b] > 0
                    ? "text-red-600"
                    : "text-brand-navy"
                }`}
              >
                {bucketCounts[b].toLocaleString("en-GB")}
              </div>
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

      <AutoRefresh intervalMs={60_000} />

      <div className="card p-4 space-y-3">
        <div className="flex items-baseline justify-between">
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

      <div className="card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold text-brand-navy">
            On duty ({onDutyOfficers.length})
          </h2>
          <p className="text-xs text-slate-500">
            Latest known position from <code className="text-xs bg-slate-100 px-1 rounded">/m/today</code>.
          </p>
        </div>
        {onDutyOfficers.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            No one is on duty right now.
          </p>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {onDutyOfficers.map((o) => {
              const hasLoc =
                typeof o.lastLat === "number" && typeof o.lastLng === "number";
              return (
                <li
                  key={o.id}
                  className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2"
                >
                  <div>
                    <Link
                      href={`/officers/${o.id}/edit`}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {o.name}
                    </Link>
                    <div className="text-[11px] text-slate-500">
                      {o.role.toLowerCase()} · seen {relativeTime(o.lastSeenAt)}
                    </div>
                  </div>
                  {hasLoc ? (
                    <a
                      href={`https://www.google.com/maps?q=${o.lastLat},${o.lastLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="chip-mint text-[10px]"
                    >
                      Map
                    </a>
                  ) : (
                    <span className="chip-slate text-[10px]">No GPS</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DataTable
        rows={rows}
        emptyState={
          <div className="space-y-3">
            <p>No live activities.</p>
            <Link href="/dispatch/new" className="btn-primary text-sm inline-block">
              + Create a job
            </Link>
          </div>
        }
        columns={[
          {
            header: "Type",
            cell: (j) => (
              <Link
                href={
                  j.__visitId
                    ? `/patrols/visits/${j.__visitId}`
                    : `/dispatch/${j.id}`
                }
                className="font-medium text-brand-navy hover:text-brand-blue-dark"
              >
                {jobTypeLabels[j.type] ?? j.type.replace(/_/g, " ")}
              </Link>
            ),
          },
          {
            header: "Scheduled",
            cell: (j) => {
              const f = formatScheduled(j.scheduledFor);
              if (!f) {
                return <span className="text-slate-400">—</span>;
              }
              const overdue =
                j.scheduledFor != null &&
                j.scheduledFor < now &&
                (j.status === "OPEN" ||
                  j.status === "ASSIGNED" ||
                  j.status === "PENDING");
              return (
                <div className="leading-tight">
                  <div
                    className={
                      overdue
                        ? "text-sm font-medium text-red-600"
                        : "text-sm font-medium text-brand-navy"
                    }
                  >
                    {f.day}
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {f.time}
                  </div>
                </div>
              );
            },
          },
          {
            header: "Site",
            cell: (j) => {
              if (!j.site) {
                return <span className="text-slate-400">—</span>;
              }
              const anchor =
                j.type === "LOCK" || j.type === "UNLOCK"
                  ? "#lockunlock-section"
                  : "";
              return (
                <div>
                  <Link
                    href={`/sites/${j.site.id}/edit${anchor}`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {j.site.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {j.site.postcodeFormatted}
                  </div>
                </div>
              );
            },
          },
          {
            header: "Customer",
            cell: (j) => (
              <span>{j.customer?.name ?? j.partner?.name ?? "—"}</span>
            ),
          },
          {
            header: "Source",
            cell: (j) => (
              <span className="chip-slate">
                {jobSourceLabels[j.source] ?? j.source.replace(/_/g, " ")}
              </span>
            ),
          },
          {
            header: "Assigned",
            cell: (j) => {
              if (j.handledByPartner) {
                return (
                  <span className="text-slate-600 italic">
                    {j.handledByPartner.name}{" "}
                    <span className="text-xs text-slate-400">
                      (partner)
                    </span>
                  </span>
                );
              }
              // PatrolVisits use a different reassign action (reassignVisit
              // lives in patrols/_actions). For now show the officer as
              // plain text; admin can edit via the visit detail page.
              if (j.__visitId) {
                return (
                  j.assignedTo?.name ?? (
                    <span className="text-slate-400">—</span>
                  )
                );
              }
              // Pre-start jobs are inline-reassignable; live ones show the
              // current officer as plain text so dispatchers don't accidentally
              // change someone mid-job.
              const editable = j.status === "OPEN" || j.status === "ASSIGNED";
              if (editable) {
                return (
                  <QuickReassignJob
                    jobId={j.id}
                    currentOfficerId={j.assignedTo?.id ?? null}
                    officers={assignableOfficers}
                    reassign={reassignJob}
                  />
                );
              }
              return (
                j.assignedTo?.name ?? (
                  <span className="text-slate-400">—</span>
                )
              );
            },
          },
          {
            header: "Status",
            // Visible distinction: in-progress + late jobs pulse so the
            // eye lands on what's actively happening right now. Pending
            // jobs stay neutral; everything else uses tone chips.
            cell: (j) => {
              const live =
                j.status === "IN_PROGRESS" || j.status === "LATE";
              return (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot
                    tone={
                      j.status === "LATE"
                        ? "warn"
                        : j.status === "IN_PROGRESS"
                          ? "live"
                          : "muted"
                    }
                    pulse={live}
                  />
                  <span className="text-xs text-slate-700">
                    {j.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                </span>
              );
            },
          },
          {
            header: "Priority",
            cell: (j) =>
              j.priority === "HIGH" ? (
                <span className="chip-red">{j.priority}</span>
              ) : (
                <span className="chip-slate">{j.priority}</span>
              ),
          },
          {
            header: "",
            align: "right",
            cell: (j) => {
              const isVisit = j.__visitId != null;
              const editHref = isVisit
                ? `/patrols/visits/${j.__visitId}/edit`
                : `/dispatch/${j.id}/edit`;
              const canEdit =
                isAdmin && j.status !== "CANCELLED";
              return (
                <div className="flex items-center justify-end gap-2">
                  {canEdit && (
                    <Link
                      href={editHref}
                      className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
                    >
                      edit
                    </Link>
                  )}
                  {/* Visits don't cancel through the dispatch board — they
                      have their own status machine on the visit detail. */}
                  {!isVisit && (
                    <CancelJobButton
                      jobId={j.id}
                      jobLabel={`${jobTypeLabels[j.type] ?? j.type.replace(/_/g, " ")} @ ${j.site?.name ?? "site"}`}
                    />
                  )}
                </div>
              );
            },
          },
        ]}
      />

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-brand-navy">Recent activity</h2>
            <p className="text-xs text-slate-500">
              Completed jobs and visits from today and the previous two days.
            </p>
          </div>
          <Link
            href="/activities"
            className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
          >
            Full log →
          </Link>
        </div>
        {recentLimited.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nothing completed in the last two days.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            <li className="hidden md:grid grid-cols-[140px_1.2fr_1.5fr_1fr] gap-3 px-4 py-2 text-xs uppercase tracking-wider text-slate-500 font-medium bg-slate-50">
              <span>When</span>
              <span>Activity</span>
              <span>Site</span>
              <span>Officer</span>
            </li>
            {recentLimited.map((r) => {
              const { day, time } = fmtRecent(r.at);
              return (
                <li key={r.id}>
                  <Link
                    href={r.href}
                    className="grid md:grid-cols-[140px_1.2fr_1.5fr_1fr] gap-1 md:gap-3 px-4 py-2.5 hover:bg-brand-blue-50/40 transition"
                  >
                    <span className="text-sm text-slate-700 tabular-nums leading-tight">
                      <span className="font-medium text-brand-navy">
                        {day}
                      </span>{" "}
                      <span className="text-slate-500">{time}</span>
                    </span>
                    <span className="text-sm text-brand-navy font-medium">
                      {r.typeLabel}
                    </span>
                    <span className="text-sm text-slate-700">
                      {r.siteName ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </span>
                    <span className="text-sm text-slate-700">
                      {r.officerName ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
