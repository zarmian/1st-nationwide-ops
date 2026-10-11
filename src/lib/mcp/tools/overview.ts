/**
 * "What's happening today" for the Claude connector — the dispatch board in
 * numbers: one UK day's work by status (scheduled-date rule), and for today a
 * live view (in progress, unassigned, overdue, awaiting review, open alarms,
 * officers on duty).
 */
import { prisma } from "@/lib/db";
import { ukWallClockToUtc } from "@/lib/dates";
import { jobHiddenAnd, siteRefHiddenAnd } from "@/lib/hiddenAccounts";
import { computeAlarmSla } from "@/lib/alarmSla";
import { KIND_LABEL } from "@/lib/reports/activitiesReport";
import { loadActivities } from "./activities";
import {
  ToolInputError,
  parseUkDay,
  siteLabel,
  ukIso,
  ukToday,
  type ToolContext,
} from "./common";

export async function getOperationsOverview(
  ctx: ToolContext,
  input: { date?: string },
) {
  const today = ukToday(ctx.now);
  const day = input.date ?? today;
  const from = parseUkDay(day);
  const to = parseUkDay(day, true);
  if (!from || !to) throw new ToolInputError(`"date" must look like 2026-10-11 (got "${day}").`);

  // The day's work, every status, scheduled-date rule (same as Activities).
  const dayWork = await loadActivities(ctx, { from, to, limit: 0 });

  const result: Record<string, unknown> = {
    date: day,
    isToday: day === today,
    scheduledThatDay: dayWork.totals,
  };
  if (day !== today) return result;

  const [y, m, d] = today.split("-").map(Number);
  const dayStart = ukWallClockToUtc(y, m, d, 0, 0, 0);
  const jobHidden = jobHiddenAnd(ctx.hidden);
  const siteHidden = siteRefHiddenAnd(ctx.hidden);
  const since24h = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);

  const [
    jobsInProgress,
    visitsInProgress,
    shiftsInProgress,
    unassignedToday,
    overdueCount,
    overdue,
    awaitingReview,
    recentAlarms,
    onDuty,
  ] = await Promise.all([
    prisma.job.findMany({
      where: { AND: [{ status: "IN_PROGRESS" }, ...jobHidden] },
      orderBy: { startedAt: "asc" },
      take: 30,
      select: {
        id: true,
        type: true,
        typeLabel: true,
        startedAt: true,
        site: { select: { code: true, name: true } },
        assignedTo: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
    }),
    prisma.patrolVisit.findMany({
      where: { AND: [{ status: { in: ["IN_PROGRESS", "LATE"] } }, ...siteHidden] },
      orderBy: { scheduledAt: "asc" },
      take: 30,
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        arrivedAt: true,
        site: { select: { code: true, name: true } },
        officer: { select: { name: true } },
        patrolSchedule: { select: { kind: true } },
      },
    }),
    prisma.shift.findMany({
      where: { AND: [{ status: "IN_PROGRESS" }, ...siteHidden] },
      orderBy: { scheduledStartsAt: "asc" },
      take: 30,
      select: {
        id: true,
        type: true,
        scheduledEndsAt: true,
        actualStartedAt: true,
        officerNameRaw: true,
        site: { select: { code: true, name: true } },
        officer: { select: { name: true } },
      },
    }),
    prisma.job.findMany({
      where: {
        AND: [
          { status: "OPEN", assignedToUserId: null, handledByPartnerId: null, externalResponder: null },
          { scheduledFor: { gte: from, lte: to } },
          ...jobHidden,
        ],
      },
      orderBy: { scheduledFor: "asc" },
      take: 30,
      select: {
        id: true,
        type: true,
        typeLabel: true,
        scheduledFor: true,
        site: { select: { code: true, name: true } },
      },
    }),
    prisma.job.count({
      where: { AND: [{ status: { in: ["OPEN", "ASSIGNED"] }, scheduledFor: { lt: dayStart } }, ...jobHidden] },
    }),
    prisma.job.findMany({
      where: { AND: [{ status: { in: ["OPEN", "ASSIGNED"] }, scheduledFor: { lt: dayStart } }, ...jobHidden] },
      orderBy: { scheduledFor: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        typeLabel: true,
        scheduledFor: true,
        site: { select: { code: true, name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.job.count({
      where: { AND: [{ status: { in: ["SUBMITTED", "REVIEW_PENDING"] } }, ...jobHidden] },
    }),
    prisma.alarmEvent.findMany({
      where: { AND: [{ receivedAt: { gte: since24h }, closedAt: null }, ...siteHidden] },
      orderBy: { receivedAt: "desc" },
      take: 30,
      select: {
        id: true,
        receivedAt: true,
        priority: true,
        zone: true,
        site: { select: { code: true, name: true } },
        job: { select: { id: true, startedAt: true, status: true, assignedTo: { select: { name: true } } } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, onDuty: true, role: "OFFICER" },
      orderBy: { name: "asc" },
      select: { name: true, lastSeenAt: true, region: { select: { name: true } } },
    }),
  ]);

  const jobKind = (j: { type: string; typeLabel: string | null }) =>
    j.typeLabel || KIND_LABEL[j.type] || j.type;

  result.live = {
    inProgress: [
      ...jobsInProgress.map((j) => ({
        record: "job",
        id: j.id,
        kind: jobKind(j),
        site: j.site ? siteLabel(j.site) : null,
        officer: j.assignedTo?.name ?? null,
        subcontractedTo: j.handledByPartner?.name ?? null,
        onSiteSince: ukIso(j.startedAt),
      })),
      ...visitsInProgress.map((v) => ({
        record: "patrol_visit",
        id: v.id,
        kind: v.patrolSchedule?.kind === "VPI" ? "VPI visit" : "Patrol visit",
        status: v.status === "LATE" ? "late (not yet attended)" : "in progress",
        site: siteLabel(v.site),
        officer: v.officer?.name ?? null,
        scheduled: ukIso(v.scheduledAt),
        arrived: ukIso(v.arrivedAt),
      })),
      ...shiftsInProgress.map((s) => ({
        record: "shift",
        id: s.id,
        kind: KIND_LABEL[`SHIFT_${s.type}`] ?? s.type,
        site: siteLabel(s.site),
        officer: s.officer?.name ?? s.officerNameRaw ?? null,
        startedAt: ukIso(s.actualStartedAt),
        endsAt: ukIso(s.scheduledEndsAt),
      })),
    ],
    unassignedJobsToday: unassignedToday.map((j) => ({
      id: j.id,
      kind: jobKind(j),
      site: j.site ? siteLabel(j.site) : null,
      scheduled: ukIso(j.scheduledFor),
    })),
    overdueOpenJobs: {
      // Dispatch board's "Missed": open/assigned work due before today.
      count: overdueCount,
      mostRecent: overdue.map((j) => ({
        id: j.id,
        kind: jobKind(j),
        site: j.site ? siteLabel(j.site) : null,
        scheduled: ukIso(j.scheduledFor),
        officer: j.assignedTo?.name ?? null,
      })),
    },
    awaitingReview,
    openAlarmsLast24h: recentAlarms.map((a) => {
      const sla = computeAlarmSla({
        receivedAt: a.receivedAt,
        arrivedAt: a.job?.startedAt ?? null,
        priority: a.priority,
        now: ctx.now,
      });
      return {
        alarmId: a.id,
        jobId: a.job?.id ?? null,
        site: siteLabel(a.site),
        zone: a.zone,
        priority: a.priority,
        received: ukIso(a.receivedAt),
        officer: a.job?.assignedTo?.name ?? null,
        sla: { status: sla.status, targetMinutes: sla.targetMins, minutesElapsed: sla.elapsedMins, responseMinutes: sla.responseMins },
      };
    }),
    officersOnDuty: onDuty.map((o) => ({
      name: o.name,
      region: o.region?.name ?? null,
      lastSeen: ukIso(o.lastSeenAt),
    })),
  };
  return result;
}
