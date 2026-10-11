/**
 * Activities for the Claude connector: jobs, patrol visits and shifts in one
 * list, filtered the way the /activities log filters them (scheduled UK day,
 * Job.customerId/partnerId for jobs and the site's for visits/shifts, the same
 * status buckets, the admin-only hidden-accounts declutter) — plus a detail
 * lookup for a single record.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  jobScheduledRange,
  shiftScheduledRange,
  visitScheduledRange,
} from "@/lib/activityWhen";
import { jobHiddenAnd, siteRefHiddenAnd } from "@/lib/hiddenAccounts";
import { KIND_LABEL, statusLabel } from "@/lib/reports/activitiesReport";
import { computeAlarmSla } from "@/lib/alarmSla";
import { proofVerdict } from "@/lib/proofOfPresence";
import {
  ToolInputError,
  isUuid,
  money,
  siteLabel,
  statusGroupOf,
  statusesFor,
  ukIso,
  type StatusGroup,
  type ToolContext,
} from "./common";

export const JOB_KINDS = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "SURVEY",
  "VPI",
  "ADHOC",
] as const;
export const ACTIVITY_KINDS = [
  ...JOB_KINDS,
  "VISIT_PATROL",
  "VISIT_VPI",
  "STATIC_GUARDING_SHIFT",
  "DOG_HANDLER_SHIFT",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const JOB_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVIEW_PENDING",
  "APPROVED",
  "SENT_TO_CLIENT",
  "CLOSED",
  "CANCELLED",
] as const;
const VISIT_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "LATE", "MISSED", "CANCELLED"] as const;
const SHIFT_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "MISSED", "ABANDONED"] as const;

export type ActivityFilters = {
  from: Date;
  to: Date;
  siteIds?: string[];
  customerIds?: string[];
  partnerIds?: string[];
  officerIds?: string[];
  regionIds?: number[];
  kinds?: readonly ActivityKind[];
  statusGroups?: readonly StatusGroup[];
  limit: number;
};

export type ActivityRow = {
  id: string;
  record: "job" | "patrol_visit" | "shift";
  kind: string;
  status: string;
  statusLabel: string;
  statusGroup: string;
  scheduled: string | null;
  site: string | null;
  siteId: string | null;
  postcode: string | null;
  region: string | null;
  customer: string | null;
  partner: string | null;
  officer: string | null;
  subcontractedTo: string | null;
  started: string | null;
  finished: string | null;
  partnerRef: string | null;
  notes?: string[];
};

const siteSelect = {
  id: true,
  code: true,
  name: true,
  postcodeFormatted: true,
  region: { select: { name: true } },
} as const;

function kindFamilies(kinds: readonly ActivityKind[] | undefined) {
  if (!kinds?.length) {
    return { jobs: true, visits: true, shifts: true, jobKinds: null, visitKinds: null, shiftTypes: null };
  }
  const jobKinds = kinds.filter((k) => (JOB_KINDS as readonly string[]).includes(k));
  const visitKinds = [
    ...(kinds.includes("VISIT_PATROL") ? ["PATROL" as const] : []),
    ...(kinds.includes("VISIT_VPI") ? ["VPI" as const] : []),
  ];
  const shiftTypes = [
    ...(kinds.includes("STATIC_GUARDING_SHIFT") ? ["STATIC_GUARDING" as const] : []),
    ...(kinds.includes("DOG_HANDLER_SHIFT") ? ["DOG_HANDLER" as const] : []),
  ];
  return {
    jobs: jobKinds.length > 0,
    visits: visitKinds.length > 0,
    shifts: shiftTypes.length > 0,
    jobKinds,
    visitKinds,
    shiftTypes,
  };
}

function buildWheres(ctx: ToolContext, f: ActivityFilters) {
  const fam = kindFamilies(f.kinds);
  const jobStatuses = statusesFor(f.statusGroups, JOB_STATUSES);
  const visitStatuses = statusesFor(f.statusGroups, VISIT_STATUSES);
  const shiftStatuses = statusesFor(f.statusGroups, SHIFT_STATUSES);

  const siteRel = (extra: Prisma.SiteWhereInput[]) =>
    extra.map((w) => ({ site: w }));
  const siteConds: Prisma.SiteWhereInput[] = [
    ...(f.customerIds ? [{ customerId: { in: f.customerIds } }] : []),
    ...(f.partnerIds ? [{ partnerId: { in: f.partnerIds } }] : []),
    ...(f.regionIds ? [{ regionId: { in: f.regionIds } }] : []),
  ];

  const job: Prisma.JobWhereInput | null =
    fam.jobs && (jobStatuses === null || jobStatuses.length)
      ? {
          AND: [
            jobScheduledRange(f.from, f.to),
            ...jobHiddenAnd(ctx.hidden),
            ...(f.siteIds ? [{ siteId: { in: f.siteIds } }] : []),
            // Activities log semantics: a job's own customer / partner columns.
            ...(f.customerIds ? [{ customerId: { in: f.customerIds } }] : []),
            ...(f.partnerIds ? [{ partnerId: { in: f.partnerIds } }] : []),
            ...(f.regionIds ? [{ site: { regionId: { in: f.regionIds } } }] : []),
            ...(f.officerIds ? [{ assignedToUserId: { in: f.officerIds } }] : []),
            ...(fam.jobKinds ? [{ type: { in: fam.jobKinds } }] : []),
            ...(jobStatuses ? [{ status: { in: jobStatuses as never[] } }] : []),
          ],
        }
      : null;

  const visit: Prisma.PatrolVisitWhereInput | null =
    fam.visits && (visitStatuses === null || visitStatuses.length)
      ? {
          AND: [
            visitScheduledRange(f.from, f.to),
            ...siteRefHiddenAnd(ctx.hidden),
            ...(f.siteIds ? [{ siteId: { in: f.siteIds } }] : []),
            ...siteRel(siteConds),
            ...(f.officerIds ? [{ officerId: { in: f.officerIds } }] : []),
            ...(fam.visitKinds ? [{ patrolSchedule: { kind: { in: fam.visitKinds } } }] : []),
            ...(visitStatuses ? [{ status: { in: visitStatuses as never[] } }] : []),
          ],
        }
      : null;

  const shift: Prisma.ShiftWhereInput | null =
    fam.shifts && (shiftStatuses === null || shiftStatuses.length)
      ? {
          AND: [
            shiftScheduledRange(f.from, f.to),
            ...siteRefHiddenAnd(ctx.hidden),
            ...(f.siteIds ? [{ siteId: { in: f.siteIds } }] : []),
            ...siteRel(siteConds),
            ...(f.officerIds ? [{ officerId: { in: f.officerIds } }] : []),
            ...(fam.shiftTypes ? [{ type: { in: fam.shiftTypes } }] : []),
            ...(shiftStatuses ? [{ status: { in: shiftStatuses as never[] } }] : []),
          ],
        }
      : null;

  return { job, visit, shift };
}

/**
 * Load activities, earliest first. Each record type is capped at limit+1, so
 * the earliest `limit` rows overall are always exact; `totals` count
 * everything in the window regardless of the cap.
 */
export async function loadActivities(ctx: ToolContext, f: ActivityFilters) {
  const w = buildWheres(ctx, f);
  const take = f.limit + 1;

  const [jobs, visits, shifts, jobCounts, visitCounts, shiftCounts] = await Promise.all([
    w.job
      ? prisma.job.findMany({
          where: w.job,
          orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { completedAt: "asc" }],
          take,
          select: {
            id: true,
            type: true,
            typeLabel: true,
            status: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            partnerActivityRef: true,
            possibleDuplicate: true,
            reportedViaPartnerApp: true,
            externalResponder: true,
            site: { select: siteSelect },
            customer: { select: { name: true } },
            partner: { select: { name: true } },
            assignedTo: { select: { name: true } },
            handledByPartner: { select: { name: true } },
          },
        })
      : [],
    w.visit
      ? prisma.patrolVisit.findMany({
          where: w.visit,
          orderBy: { scheduledAt: "asc" },
          take,
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            arrivedAt: true,
            departedAt: true,
            partnerActivityRef: true,
            reportedViaPartnerApp: true,
            site: {
              select: {
                ...siteSelect,
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { name: true } },
            handledByPartner: { select: { name: true } },
            patrolSchedule: { select: { kind: true } },
          },
        })
      : [],
    w.shift
      ? prisma.shift.findMany({
          where: w.shift,
          orderBy: { scheduledStartsAt: "asc" },
          take,
          select: {
            id: true,
            type: true,
            status: true,
            scheduledStartsAt: true,
            actualStartedAt: true,
            actualEndedAt: true,
            officerNameRaw: true,
            site: {
              select: {
                ...siteSelect,
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { name: true } },
            handledByPartner: { select: { name: true } },
          },
        })
      : [],
    w.job ? prisma.job.groupBy({ by: ["status"], where: w.job, _count: { _all: true } }) : [],
    w.visit ? prisma.patrolVisit.groupBy({ by: ["status"], where: w.visit, _count: { _all: true } }) : [],
    w.shift ? prisma.shift.groupBy({ by: ["status"], where: w.shift, _count: { _all: true } }) : [],
  ]);

  const rows: (ActivityRow & { at: number })[] = [];

  for (const j of jobs) {
    const at = j.scheduledFor ?? j.startedAt ?? j.completedAt ?? j.createdAt;
    const notes: string[] = [];
    if (j.possibleDuplicate) notes.push("possible duplicate of a manually entered job");
    if (j.reportedViaPartnerApp) notes.push("reported in the partner's app");
    rows.push({
      at: at.getTime(),
      id: j.id,
      record: "job",
      kind: j.typeLabel || KIND_LABEL[j.type] || j.type,
      status: j.status,
      statusLabel: statusLabel(j.status),
      statusGroup: statusGroupOf(j.status),
      scheduled: ukIso(at),
      site: j.site ? siteLabel(j.site) : null,
      siteId: j.site?.id ?? null,
      postcode: j.site?.postcodeFormatted ?? null,
      region: j.site?.region?.name ?? null,
      customer: j.customer?.name ?? null,
      partner: j.partner?.name ?? null,
      officer: j.assignedTo?.name ?? j.externalResponder ?? null,
      subcontractedTo: j.handledByPartner?.name ?? null,
      started: ukIso(j.startedAt),
      finished: ukIso(j.completedAt),
      partnerRef: j.partnerActivityRef,
      ...(notes.length ? { notes } : {}),
    });
  }
  for (const v of visits) {
    const kind = v.patrolSchedule?.kind === "VPI" ? "VISIT_VPI" : "VISIT_PATROL";
    rows.push({
      at: v.scheduledAt.getTime(),
      id: v.id,
      record: "patrol_visit",
      kind: KIND_LABEL[kind] ?? "Patrol visit",
      status: v.status,
      statusLabel: statusLabel(v.status),
      statusGroup: statusGroupOf(v.status),
      scheduled: ukIso(v.scheduledAt),
      site: siteLabel(v.site),
      siteId: v.site.id,
      postcode: v.site.postcodeFormatted,
      region: v.site.region?.name ?? null,
      customer: v.site.customer?.name ?? null,
      partner: v.site.partner?.name ?? null,
      officer: v.officer?.name ?? null,
      subcontractedTo: v.handledByPartner?.name ?? null,
      started: ukIso(v.arrivedAt),
      finished: ukIso(v.departedAt),
      partnerRef: v.partnerActivityRef,
      ...(v.reportedViaPartnerApp ? { notes: ["reported in the partner's app"] } : {}),
    });
  }
  for (const s of shifts) {
    rows.push({
      at: s.scheduledStartsAt.getTime(),
      id: s.id,
      record: "shift",
      kind: KIND_LABEL[`SHIFT_${s.type}`] ?? s.type,
      status: s.status,
      statusLabel: statusLabel(s.status),
      statusGroup: statusGroupOf(s.status),
      scheduled: ukIso(s.scheduledStartsAt),
      site: siteLabel(s.site),
      siteId: s.site.id,
      postcode: s.site.postcodeFormatted,
      region: s.site.region?.name ?? null,
      customer: s.site.customer?.name ?? null,
      partner: s.site.partner?.name ?? null,
      officer: s.officer?.name ?? s.officerNameRaw ?? null,
      subcontractedTo: s.handledByPartner?.name ?? null,
      started: ukIso(s.actualStartedAt),
      finished: ukIso(s.actualEndedAt),
      partnerRef: null,
    });
  }

  rows.sort((a, b) => a.at - b.at);
  const truncated =
    jobs.length > f.limit || visits.length > f.limit || shifts.length > f.limit || rows.length > f.limit;

  const totals = { total: 0, jobs: 0, patrolVisits: 0, shifts: 0, byStatusGroup: {} as Record<string, number> };
  const add = (counts: { status: string; _count: { _all: number } }[], key: "jobs" | "patrolVisits" | "shifts") => {
    for (const c of counts) {
      totals[key] += c._count._all;
      totals.total += c._count._all;
      const g = statusGroupOf(c.status);
      totals.byStatusGroup[g] = (totals.byStatusGroup[g] ?? 0) + c._count._all;
    }
  };
  add(jobCounts as never, "jobs");
  add(visitCounts as never, "patrolVisits");
  add(shiftCounts as never, "shifts");

  return {
    totals,
    truncated,
    rows: rows.slice(0, f.limit).map(({ at: _at, ...r }) => r),
  };
}

// ── One record in detail ───────────────────────────────────────────────────

const detailSiteSelect = {
  id: true,
  code: true,
  name: true,
  addressLine: true,
  city: true,
  postcodeFormatted: true,
  lat: true,
  lng: true,
  geofenceRadiusM: true,
  dne: true,
  hsMarkers: true,
  customer: { select: { name: true } },
  partner: { select: { name: true } },
  region: { select: { name: true } },
} as const;

type DetailSite = {
  id: string;
  code: string | null;
  name: string;
  addressLine: string;
  city: string | null;
  postcodeFormatted: string;
  lat: number | null;
  lng: number | null;
  geofenceRadiusM: number | null;
  dne: boolean;
  hsMarkers: boolean;
  customer: { name: string } | null;
  partner: { name: string } | null;
  region: { name: string } | null;
};

function siteSummary(s: DetailSite | null) {
  if (!s) return null;
  return {
    id: s.id,
    name: siteLabel(s),
    address: [s.addressLine, s.city, s.postcodeFormatted].filter(Boolean).join(", "),
    customer: s.customer?.name ?? null,
    partner: s.partner?.name ?? null,
    region: s.region?.name ?? null,
    flags: [
      ...(s.dne ? ["DO NOT ENGAGE"] : []),
      ...(s.hsMarkers ? ["Health & safety markers"] : []),
    ],
  };
}

function presence(
  fix: { lat: number | null; lng: number | null; at: Date | null },
  site: DetailSite | null,
) {
  const v = proofVerdict({
    gpsLat: fix.lat,
    gpsLng: fix.lng,
    locatedAt: fix.at,
    siteLat: site?.lat,
    siteLng: site?.lng,
    radiusM: site?.geofenceRadiusM,
  });
  return {
    verdict: v.status, // within | outside | no_site_coords | no_fix
    distanceMetres: v.distanceM != null ? Math.round(v.distanceM) : null,
    geofenceMetres: v.radiusM,
    fixAt: ukIso(v.locatedAt),
  };
}

export async function getActivity(
  ctx: ToolContext,
  input: { id?: string; reference?: string },
) {
  const id = input.id?.trim();
  const ref = input.reference?.trim();
  if (!id && !ref) {
    throw new ToolInputError("Give the activity's id (from list_activities) or a partner reference like LINK-12345 or J21634508.");
  }
  if (id && !isUuid(id)) {
    throw new ToolInputError(`"${id}" isn't an id. Ids look like 3f2b…-…; for LINK-/J… numbers use "reference".`);
  }

  const jobWhere: Prisma.JobWhereInput | null = id
    ? { id }
    : ref
      ? { OR: [{ partnerActivityRef: ref }, { partnerReportRef: ref }] }
      : null;
  const job = jobWhere
    ? await prisma.job.findFirst({
        where: jobWhere,
        select: {
          id: true,
          type: true,
          typeLabel: true,
          source: true,
          status: true,
          priority: true,
          scheduledFor: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          cancelledAt: true,
          lat: true,
          lng: true,
          locatedAt: true,
          notes: true,
          partnerActivityRef: true,
          partnerReportRef: true,
          reportedViaPartnerApp: true,
          possibleDuplicate: true,
          excludeFromClientReport: true,
          externalResponder: true,
          billedAmount: true,
          paidAmount: true,
          partnerChargeToUsAmount: true,
          site: { select: detailSiteSelect },
          customer: { select: { name: true } },
          partner: { select: { name: true } },
          assignedTo: { select: { name: true } },
          handledByPartner: { select: { name: true } },
          cancelledBy: { select: { name: true } },
          alarmEvent: {
            select: {
              id: true,
              source: true,
              receivedAt: true,
              zone: true,
              rawSubject: true,
              priority: true,
              outcome: true,
              closedAt: true,
              notes: true,
            },
          },
        },
      })
    : null;

  if (job) {
    const alarm = job.alarmEvent
      ? (() => {
          const sla = computeAlarmSla({
            receivedAt: job.alarmEvent.receivedAt,
            arrivedAt: job.startedAt,
            priority: job.alarmEvent.priority,
            now: ctx.now,
          });
          return {
            id: job.alarmEvent.id,
            source: job.alarmEvent.source,
            received: ukIso(job.alarmEvent.receivedAt),
            zone: job.alarmEvent.zone,
            subject: job.alarmEvent.rawSubject,
            priority: job.alarmEvent.priority,
            outcome: job.alarmEvent.outcome,
            closed: ukIso(job.alarmEvent.closedAt),
            notes: job.alarmEvent.notes,
            sla: {
              status: sla.status, // responding | at_risk | breached | met
              targetMinutes: sla.targetMins,
              responseMinutes: sla.responseMins,
            },
          };
        })()
      : null;
    return {
      record: "job",
      id: job.id,
      kind: job.typeLabel || KIND_LABEL[job.type] || job.type,
      source: job.source,
      status: job.status,
      statusLabel: statusLabel(job.status),
      priority: job.priority,
      scheduled: ukIso(job.scheduledFor),
      onSite: ukIso(job.startedAt),
      completed: ukIso(job.completedAt),
      cancelled: job.cancelledAt
        ? { at: ukIso(job.cancelledAt), by: job.cancelledBy?.name ?? null }
        : null,
      created: ukIso(job.createdAt),
      site: siteSummary(job.site),
      customer: job.customer?.name ?? null,
      partner: job.partner?.name ?? null,
      officer: job.assignedTo?.name ?? job.externalResponder ?? null,
      subcontractedTo: job.handledByPartner?.name ?? null,
      partnerActivityRef: job.partnerActivityRef,
      partnerReportRef: job.partnerReportRef,
      reportedViaPartnerApp: job.reportedViaPartnerApp,
      possibleDuplicate: job.possibleDuplicate,
      internalOnly: job.excludeFromClientReport,
      notes: job.notes,
      proofOfPresence: presence({ lat: job.lat, lng: job.lng, at: job.locatedAt }, job.site),
      alarm,
      ...(ctx.isAdmin
        ? {
            money: {
              billed: money(job.billedAmount),
              officerPay: money(job.paidAmount),
              partnerCharge: money(job.partnerChargeToUsAmount),
            },
          }
        : {}),
    };
  }

  const visit = await prisma.patrolVisit.findFirst({
    where: id ? { id } : { partnerActivityRef: ref },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      scheduleDate: true,
      arrivedAt: true,
      departedAt: true,
      cancelledAt: true,
      gpsLat: true,
      gpsLng: true,
      lat: true,
      lng: true,
      locatedAt: true,
      notes: true,
      photoUrls: true,
      partnerActivityRef: true,
      reportedViaPartnerApp: true,
      billedAmount: true,
      paidAmount: true,
      partnerChargeToUsAmount: true,
      site: { select: detailSiteSelect },
      officer: { select: { name: true } },
      handledByPartner: { select: { name: true } },
      patrolSchedule: { select: { kind: true, frequency: true, dayOfWeek: true } },
    },
  });
  if (visit) {
    const fixLat = visit.gpsLat ?? visit.lat;
    const fixLng = visit.gpsLng ?? visit.lng;
    return {
      record: "patrol_visit",
      id: visit.id,
      kind: visit.patrolSchedule?.kind === "VPI" ? "VPI visit" : "Patrol visit",
      schedule: visit.patrolSchedule
        ? { frequency: visit.patrolSchedule.frequency, day: visit.patrolSchedule.dayOfWeek }
        : null,
      status: visit.status,
      statusLabel: statusLabel(visit.status),
      scheduled: ukIso(visit.scheduledAt),
      arrived: ukIso(visit.arrivedAt),
      departed: ukIso(visit.departedAt),
      cancelled: ukIso(visit.cancelledAt),
      site: siteSummary(visit.site),
      officer: visit.officer?.name ?? null,
      subcontractedTo: visit.handledByPartner?.name ?? null,
      partnerActivityRef: visit.partnerActivityRef,
      reportedViaPartnerApp: visit.reportedViaPartnerApp,
      photos: visit.photoUrls.length,
      notes: visit.notes,
      proofOfPresence: presence({ lat: fixLat, lng: fixLng, at: visit.locatedAt ?? visit.arrivedAt }, visit.site),
      ...(ctx.isAdmin
        ? {
            money: {
              billed: money(visit.billedAmount),
              officerPay: money(visit.paidAmount),
              partnerCharge: money(visit.partnerChargeToUsAmount),
            },
          }
        : {}),
    };
  }

  const shift = id
    ? await prisma.shift.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          status: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          actualStartedAt: true,
          actualEndedAt: true,
          checkIntervalMin: true,
          graceMinutes: true,
          startWithinGeofence: true,
          startDistanceM: true,
          endWithinGeofence: true,
          endDistanceM: true,
          endedLate: true,
          lateReason: true,
          payableMinutes: true,
          notes: true,
          officerNameRaw: true,
          billedAmount: true,
          paidAmount: true,
          partnerChargeToUsAmount: true,
          site: { select: detailSiteSelect },
          officer: { select: { name: true } },
          handledByPartner: { select: { name: true } },
        },
      })
    : null;
  if (shift) {
    return {
      record: "shift",
      id: shift.id,
      kind: KIND_LABEL[`SHIFT_${shift.type}`] ?? shift.type,
      status: shift.status,
      statusLabel: statusLabel(shift.status),
      scheduledStart: ukIso(shift.scheduledStartsAt),
      scheduledEnd: ukIso(shift.scheduledEndsAt),
      actualStart: ukIso(shift.actualStartedAt),
      actualEnd: ukIso(shift.actualEndedAt),
      checkInEveryMinutes: shift.checkIntervalMin,
      graceMinutes: shift.graceMinutes,
      startOnSite: shift.startWithinGeofence,
      startDistanceMetres: shift.startDistanceM != null ? Math.round(shift.startDistanceM) : null,
      endOnSite: shift.endWithinGeofence,
      endDistanceMetres: shift.endDistanceM != null ? Math.round(shift.endDistanceM) : null,
      endedLate: shift.endedLate,
      lateReason: shift.lateReason,
      payableMinutes: shift.payableMinutes,
      site: siteSummary(shift.site),
      officer: shift.officer?.name ?? shift.officerNameRaw ?? null,
      subcontractedTo: shift.handledByPartner?.name ?? null,
      notes: shift.notes,
      ...(ctx.isAdmin
        ? {
            money: {
              billed: money(shift.billedAmount),
              officerPay: money(shift.paidAmount),
              partnerCharge: money(shift.partnerChargeToUsAmount),
            },
          }
        : {}),
    };
  }

  // An alarm id resolves to its response job, if it has one.
  if (id) {
    const alarm = await prisma.alarmEvent.findUnique({
      where: { id },
      select: { job: { select: { id: true } } },
    });
    if (alarm?.job) return getActivity(ctx, { id: alarm.job.id });
  }

  throw new ToolInputError(
    id
      ? `Nothing found with id ${id}.`
      : `No job or patrol visit has the reference "${ref}".`,
  );
}
