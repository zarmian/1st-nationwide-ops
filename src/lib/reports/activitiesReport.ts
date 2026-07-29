/**
 * Shared loader for the activities report — the same job/visit/shift merge the
 * /activities page + CSV export use, distilled to normalised rows so both the
 * CSV route and the PDF report render off one source of truth.
 */
import { prisma } from "@/lib/db";

const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static-guarding shift",
  DOG_HANDLER_SHIFT: "Dog-handler shift",
  VISIT_PATROL: "Patrol visit",
  VISIT_VPI: "VPI visit",
  SHIFT_STATIC_GUARDING: "Static-guarding shift",
  SHIFT_DOG_HANDLER: "Dog-handler shift",
};

const STATUS_GROUPS: Record<string, Set<string>> = {
  scheduled: new Set(["OPEN", "ASSIGNED", "PENDING", "DRAFT"]),
  in_progress: new Set(["IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING", "LATE"]),
  completed: new Set([
    "COMPLETED",
    "APPROVED",
    "SENT_TO_CLIENT",
    "CLOSED",
    "EDITED_AND_APPROVED",
  ]),
  missed: new Set(["MISSED", "ABANDONED"]),
  cancelled: new Set(["CANCELLED"]),
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Scheduled",
  ASSIGNED: "Assigned",
  PENDING: "Scheduled",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  REVIEW_PENDING: "In review",
  LATE: "Late",
  COMPLETED: "Completed",
  APPROVED: "Completed",
  SENT_TO_CLIENT: "Sent to client",
  CLOSED: "Closed",
  MISSED: "Missed",
  ABANDONED: "Abandoned",
  CANCELLED: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export type ActivityReportRow = {
  at: Date;
  kind: string;
  siteCode: string | null;
  siteName: string | null;
  region: string | null;
  customer: string | null;
  partner: string | null;
  officer: string | null;
  billed: number | null;
  paid: number | null;
  status: string;
  /// "lat, lng" once location capture is wired in; null otherwise.
  location: string | null;
};

export type ActivityReportParams = {
  from: Date;
  to: Date;
  customerIds: string[];
  partnerIds: string[];
  officerIds: string[];
  siteIds: string[];
  regionIds: number[];
  kinds: string[];
  statuses: string[];
};

function parseLocalDate(s: string | null, endOfDay = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/** Parse the /activities query-string into report params (defaults to the
 *  current month, all filters open). */
export function parseActivitiesQuery(url: URL): ActivityReportParams {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  const from = parseLocalDate(url.searchParams.get("from")) ?? monthStart;
  const to = parseLocalDate(url.searchParams.get("to"), true) ?? monthEnd;

  const splitCsv = (v: string | null): string[] =>
    v ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];

  let customerIds = splitCsv(url.searchParams.get("customerId"));
  let partnerIds = splitCsv(url.searchParams.get("partnerId"));
  const accountId = url.searchParams.get("accountId");
  if (accountId) {
    const [aKind, id] = accountId.split(":");
    if (aKind === "customer" && id) customerIds = [id];
    else if (aKind === "partner" && id) partnerIds = [id];
  }

  return {
    from,
    to,
    customerIds,
    partnerIds,
    officerIds: splitCsv(url.searchParams.get("officerId")),
    siteIds: splitCsv(url.searchParams.get("siteId")),
    regionIds: splitCsv(url.searchParams.get("regionId"))
      .map((r) => Number(r))
      .filter((n) => Number.isFinite(n)),
    kinds: splitCsv(url.searchParams.get("kind")),
    statuses: splitCsv(url.searchParams.get("status")),
  };
}

/** Load + normalise + status-filter + sort the activities for a report. */
export async function loadActivitiesReportRows(
  params: ActivityReportParams,
): Promise<ActivityReportRow[]> {
  const dateInRange = { gte: params.from, lte: params.to };
  const visitWhere: any = { scheduledAt: dateInRange };
  const jobWhere: any = {
    OR: [
      { scheduledFor: dateInRange },
      { AND: [{ scheduledFor: null }, { createdAt: dateInRange }] },
    ],
  };
  const shiftWhere: any = { scheduledStartsAt: dateInRange };

  if (params.officerIds.length) {
    visitWhere.officerId = { in: params.officerIds };
    jobWhere.assignedToUserId = { in: params.officerIds };
    shiftWhere.officerId = { in: params.officerIds };
  }
  if (params.siteIds.length) {
    visitWhere.siteId = { in: params.siteIds };
    jobWhere.siteId = { in: params.siteIds };
    shiftWhere.siteId = { in: params.siteIds };
  }
  if (params.customerIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), customerId: { in: params.customerIds } };
    jobWhere.customerId = { in: params.customerIds };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), customerId: { in: params.customerIds } };
  }
  if (params.partnerIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), partnerId: { in: params.partnerIds } };
    jobWhere.partnerId = { in: params.partnerIds };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), partnerId: { in: params.partnerIds } };
  }
  if (params.regionIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), regionId: { in: params.regionIds } };
    jobWhere.site = { ...(jobWhere.site ?? {}), regionId: { in: params.regionIds } };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), regionId: { in: params.regionIds } };
  }

  const kindSet = new Set(params.kinds);
  const wantVisitPatrol = kindSet.has("VISIT_PATROL");
  const wantVisitVpi = kindSet.has("VISIT_VPI");
  const wantShiftStatic =
    kindSet.has("STATIC_GUARDING_SHIFT") || kindSet.has("SHIFT_STATIC_GUARDING");
  const wantShiftDog =
    kindSet.has("DOG_HANDLER_SHIFT") || kindSet.has("SHIFT_DOG_HANDLER");
  const jobKinds = [...kindSet].filter(
    (k) =>
      k !== "VISIT_PATROL" &&
      k !== "VISIT_VPI" &&
      k !== "STATIC_GUARDING_SHIFT" &&
      k !== "DOG_HANDLER_SHIFT" &&
      k !== "SHIFT_STATIC_GUARDING" &&
      k !== "SHIFT_DOG_HANDLER",
  );

  let loadVisits = true;
  let loadJobs = true;
  let loadShifts = true;
  if (params.kinds.length > 0) {
    const wantsAnyVisit = wantVisitPatrol || wantVisitVpi;
    const wantsAnyShift = wantShiftStatic || wantShiftDog;
    const wantsAnyJob = jobKinds.length > 0;
    loadVisits = wantsAnyVisit;
    loadJobs = wantsAnyJob;
    loadShifts = wantsAnyShift;
    if (wantsAnyVisit) {
      const visitKindFilter: string[] = [];
      if (wantVisitPatrol) visitKindFilter.push("PATROL");
      if (wantVisitVpi) visitKindFilter.push("VPI");
      visitWhere.patrolSchedule = { kind: { in: visitKindFilter } };
    }
    if (wantsAnyJob) jobWhere.type = { in: jobKinds };
    if (wantShiftStatic && !wantShiftDog) shiftWhere.type = "STATIC_GUARDING";
    else if (wantShiftDog && !wantShiftStatic) shiftWhere.type = "DOG_HANDLER";
  }

  const [visits, jobs, shifts] = await Promise.all([
    loadVisits
      ? prisma.patrolVisit.findMany({
          where: visitWhere,
          include: {
            site: {
              select: {
                code: true,
                name: true,
                region: { select: { name: true } },
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { name: true } },
            patrolSchedule: { select: { kind: true } },
          },
          orderBy: [{ scheduledAt: "desc" }],
        })
      : Promise.resolve([] as any[]),
    loadJobs
      ? prisma.job.findMany({
          where: jobWhere,
          include: {
            site: {
              select: {
                code: true,
                name: true,
                region: { select: { name: true } },
              },
            },
            customer: { select: { name: true } },
            partner: { select: { name: true } },
            assignedTo: { select: { name: true } },
            handledByPartner: { select: { name: true } },
          },
          orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([] as any[]),
    loadShifts
      ? prisma.shift.findMany({
          where: shiftWhere,
          include: {
            site: {
              select: {
                code: true,
                name: true,
                region: { select: { name: true } },
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { name: true } },
            handledByPartner: { select: { name: true } },
          },
          orderBy: [{ scheduledStartsAt: "desc" }],
        })
      : Promise.resolve([] as any[]),
  ]);

  const rows: ActivityReportRow[] = [];
  for (const v of visits) {
    const vk = v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL";
    rows.push({
      at: v.scheduledAt ?? v.arrivedAt ?? v.createdAt ?? new Date(),
      kind: KIND_LABEL[`VISIT_${vk}`] ?? "Visit",
      siteCode: v.site?.code ?? null,
      siteName: v.site?.name ?? null,
      region: v.site?.region?.name ?? null,
      customer: v.site?.customer?.name ?? null,
      partner: v.site?.partner?.name ?? null,
      officer: v.officer?.name ?? null,
      billed: v.billedAmount != null ? Number(v.billedAmount) : null,
      paid: v.paidAmount != null ? Number(v.paidAmount) : null,
      status: v.status,
      location: null,
    });
  }
  for (const j of jobs) {
    rows.push({
      at: j.scheduledFor ?? j.startedAt ?? j.createdAt ?? new Date(),
      kind: KIND_LABEL[j.type] ?? j.type,
      siteCode: j.site?.code ?? null,
      siteName: j.site?.name ?? null,
      region: j.site?.region?.name ?? null,
      customer: j.customer?.name ?? null,
      partner: j.partner?.name ?? null,
      officer: j.handledByPartner
        ? `${j.handledByPartner.name} (partner)`
        : (j.assignedTo?.name ?? null),
      billed: j.billedAmount != null ? Number(j.billedAmount) : null,
      paid: j.paidAmount != null ? Number(j.paidAmount) : null,
      status: j.status,
      location: null,
    });
  }
  for (const sh of shifts) {
    rows.push({
      at: sh.scheduledStartsAt ?? sh.actualStartedAt ?? sh.createdAt ?? new Date(),
      kind: KIND_LABEL[`SHIFT_${sh.type}`] ?? sh.type,
      siteCode: sh.site?.code ?? null,
      siteName: sh.site?.name ?? null,
      region: sh.site?.region?.name ?? null,
      customer: sh.site?.customer?.name ?? null,
      partner: sh.site?.partner?.name ?? null,
      officer: sh.handledByPartner
        ? `${sh.handledByPartner.name} (partner)`
        : (sh.officer?.name ?? null),
      billed: sh.billedAmount != null ? Number(sh.billedAmount) : null,
      paid: sh.paidAmount != null ? Number(sh.paidAmount) : null,
      status: sh.status,
      location: null,
    });
  }

  let filtered = rows;
  if (params.statuses.length > 0) {
    const allowed = new Set<string>();
    for (const g of params.statuses) {
      const set = STATUS_GROUPS[g];
      if (set) for (const s of set) allowed.add(s);
    }
    filtered = rows.filter((r) => allowed.has(r.status));
  }
  filtered.sort((a, b) => b.at.getTime() - a.at.getTime());
  return filtered;
}
