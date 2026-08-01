/**
 * Load a single day's activities across jobs, patrol visits and shifts —
 * the same three sources the /activities page merges — and render them for
 * the Telegram bot. Anchored on the SCHEDULED date in UK terms (matching
 * lib/activityWhen), so a job scheduled for the 30th shows on the 30th even
 * if it was closed later.
 */
import { prisma } from "@/lib/db";
import { ukDayPlus, ukWallClockToUtc } from "@/lib/dates";
import {
  ACTIVITY_KIND_LABEL,
  formatDayActivitiesMessage,
  formatNowMessage,
  resolveDayTarget,
  type DayActivity,
  type DayTarget,
} from "@/lib/dayActivitiesFormat";

function whoLabel(
  officer?: string | null,
  partner?: string | null,
): string {
  if (partner) return `${partner} (partner)`;
  return officer ?? "Unassigned";
}

/**
 * All non-cancelled activities whose scheduled date falls on `target`
 * (UK day), sorted chronologically. Optional siteId narrows to one site.
 */
export async function loadDayActivities(
  target: Pick<DayTarget, "year" | "month" | "day">,
  opts?: {
    siteId?: string;
    officerId?: string;
    customerId?: string;
    partnerId?: string;
  },
): Promise<DayActivity[]> {
  const start = ukWallClockToUtc(target.year, target.month, target.day, 0, 0, 0);
  const end = ukWallClockToUtc(
    target.year,
    target.month,
    target.day,
    23,
    59,
    59,
  );
  const range = { gte: start, lte: end };
  const site = opts?.siteId ? { siteId: opts.siteId } : {};
  const jobOfficer = opts?.officerId
    ? { assignedToUserId: opts.officerId }
    : {};
  const officer = opts?.officerId ? { officerId: opts.officerId } : {};
  // Account (customer/partner) scope. Jobs carry the account directly; visits
  // and shifts inherit it through their site.
  const jobAccount = opts?.customerId
    ? { customerId: opts.customerId }
    : opts?.partnerId
      ? { partnerId: opts.partnerId }
      : {};
  const siteAccount = opts?.customerId
    ? { site: { is: { customerId: opts.customerId } } }
    : opts?.partnerId
      ? { site: { is: { partnerId: opts.partnerId } } }
      : {};

  const [jobs, visits, shifts] = await prisma.$transaction([
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        ...site,
        ...jobOfficer,
        ...jobAccount,
        OR: [
          { scheduledFor: range },
          { AND: [{ scheduledFor: null }, { createdAt: range }] },
        ],
      },
      select: {
        type: true,
        typeLabel: true,
        scheduledFor: true,
        startedAt: true,
        createdAt: true,
        status: true,
        site: { select: { name: true } },
        assignedTo: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      take: 500,
    }),
    prisma.patrolVisit.findMany({
      where: {
        status: { not: "CANCELLED" },
        ...site,
        ...officer,
        ...siteAccount,
        scheduledAt: range,
      },
      select: {
        scheduledAt: true,
        status: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
        patrolSchedule: { select: { kind: true } },
      },
      take: 500,
    }),
    prisma.shift.findMany({
      where: { ...site, ...officer, ...siteAccount, scheduledStartsAt: range },
      select: {
        type: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        status: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      take: 500,
    }),
  ]);

  const rows: DayActivity[] = [];

  for (const j of jobs) {
    rows.push({
      at: j.scheduledFor ?? j.startedAt ?? j.createdAt ?? start,
      endsAt: null,
      kindLabel: j.typeLabel?.trim() || ACTIVITY_KIND_LABEL[j.type] || j.type,
      siteName: j.site?.name ?? "—",
      who: whoLabel(j.assignedTo?.name, j.handledByPartner?.name),
      status: j.status,
      source: "JOB",
    });
  }

  for (const v of visits) {
    const vkind = v.patrolSchedule?.kind === "VPI" ? "VISIT_VPI" : "VISIT_PATROL";
    rows.push({
      at: v.scheduledAt,
      endsAt: null,
      kindLabel: ACTIVITY_KIND_LABEL[vkind] ?? "Patrol",
      siteName: v.site?.name ?? "—",
      who: whoLabel(v.officer?.name, v.handledByPartner?.name),
      status: v.status,
      source: "VISIT",
    });
  }

  for (const s of shifts) {
    const kind =
      s.type === "DOG_HANDLER" ? "DOG_HANDLER_SHIFT" : "STATIC_GUARDING_SHIFT";
    rows.push({
      at: s.scheduledStartsAt,
      endsAt: s.scheduledEndsAt ?? null,
      kindLabel: ACTIVITY_KIND_LABEL[kind] ?? kind,
      siteName: s.site?.name ?? "—",
      who: whoLabel(s.officer?.name, s.handledByPartner?.name),
      status: s.status,
      source: "SHIFT",
    });
  }

  rows.sort((a, b) => a.at.getTime() - b.at.getTime());
  return rows;
}

/**
 * End-to-end: resolve the day keyword, load its activities, and return the
 * Telegram message. `siteId` (+ `siteNote`) narrow + annotate the list.
 */
export async function dayRundownMessage(
  dayInput: string,
  opts?: {
    siteId?: string;
    customerId?: string;
    partnerId?: string;
    scopeNote?: string;
  },
): Promise<string> {
  const target = resolveDayTarget(dayInput);
  if (!target) {
    return "I can show <b>today</b>, <b>yesterday</b>, <b>tomorrow</b>, or a date like <b>3 Aug</b> — which day?";
  }
  const rows = await loadDayActivities(target, {
    siteId: opts?.siteId,
    customerId: opts?.customerId,
    partnerId: opts?.partnerId,
  });
  return formatDayActivitiesMessage(rows, target.label, opts?.scopeNote);
}

/** One officer's own activities for a day, as a Telegram message. */
export async function myDayMessage(
  officerId: string,
  dayInput = "today",
): Promise<string> {
  const target = resolveDayTarget(dayInput);
  if (!target) return "Try /mine for today's jobs.";
  const rows = await loadDayActivities(target, { officerId });
  return formatDayActivitiesMessage(rows, `${target.label} — your jobs`);
}

/**
 * The live "on now" snapshot: activities in progress right now, plus those
 * overdue / not started (scoped to today). Shifts count as "in progress"
 * while now sits inside their window.
 */
export async function loadNowSnapshot(
  now: Date = new Date(),
): Promise<{ active: DayActivity[]; overdue: DayActivity[] }> {
  const t = ukDayPlus(now, 0);
  const todayStart = ukWallClockToUtc(t.year, t.month, t.day, 0, 0, 0);
  const pastToday = { gte: todayStart, lt: now };

  const [
    activeShifts,
    inProgressJobs,
    activeVisits,
    overdueJobs,
    overdueVisits,
    missedShifts,
  ] = await prisma.$transaction([
    prisma.shift.findMany({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        scheduledStartsAt: { lte: now },
        scheduledEndsAt: { gte: now },
      },
      select: {
        type: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        status: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      take: 200,
    }),
    prisma.job.findMany({
      where: { status: "IN_PROGRESS" },
      select: {
        type: true,
        typeLabel: true,
        scheduledFor: true,
        startedAt: true,
        status: true,
        site: { select: { name: true } },
        assignedTo: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      take: 200,
    }),
    prisma.patrolVisit.findMany({
      where: { status: { in: ["IN_PROGRESS", "LATE"] } },
      select: {
        scheduledAt: true,
        arrivedAt: true,
        status: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
        patrolSchedule: { select: { kind: true } },
      },
      take: 200,
    }),
    prisma.job.findMany({
      where: { status: { in: ["OPEN", "ASSIGNED"] }, scheduledFor: pastToday },
      select: {
        type: true,
        typeLabel: true,
        scheduledFor: true,
        startedAt: true,
        status: true,
        site: { select: { name: true } },
        assignedTo: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      take: 200,
    }),
    prisma.patrolVisit.findMany({
      where: { status: { in: ["PENDING", "MISSED"] }, scheduledAt: pastToday },
      select: {
        scheduledAt: true,
        arrivedAt: true,
        status: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
        patrolSchedule: { select: { kind: true } },
      },
      take: 200,
    }),
    prisma.shift.findMany({
      where: { status: "MISSED", scheduledStartsAt: pastToday },
      select: {
        type: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        status: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
      take: 200,
    }),
  ]);

  const shiftRow = (s: (typeof activeShifts)[number]): DayActivity => ({
    at: s.scheduledStartsAt,
    endsAt: s.scheduledEndsAt ?? null,
    kindLabel:
      ACTIVITY_KIND_LABEL[
        s.type === "DOG_HANDLER" ? "DOG_HANDLER_SHIFT" : "STATIC_GUARDING_SHIFT"
      ] ?? "Shift",
    siteName: s.site?.name ?? "—",
    who: whoLabel(s.officer?.name, s.handledByPartner?.name),
    status: s.status,
    source: "SHIFT",
  });
  const visitRow = (v: (typeof activeVisits)[number]): DayActivity => ({
    at: v.arrivedAt ?? v.scheduledAt,
    endsAt: null,
    kindLabel:
      ACTIVITY_KIND_LABEL[
        v.patrolSchedule?.kind === "VPI" ? "VISIT_VPI" : "VISIT_PATROL"
      ] ?? "Patrol",
    siteName: v.site?.name ?? "—",
    who: whoLabel(v.officer?.name, v.handledByPartner?.name),
    status: v.status,
    source: "VISIT",
  });
  const jobRow = (j: (typeof inProgressJobs)[number]): DayActivity => ({
    at: j.startedAt ?? j.scheduledFor ?? todayStart,
    endsAt: null,
    kindLabel: j.typeLabel?.trim() || ACTIVITY_KIND_LABEL[j.type] || j.type,
    siteName: j.site?.name ?? "—",
    who: whoLabel(j.assignedTo?.name, j.handledByPartner?.name),
    status: j.status,
    source: "JOB",
  });

  const byTime = (a: DayActivity, b: DayActivity) =>
    a.at.getTime() - b.at.getTime();

  const active = [
    ...inProgressJobs.map(jobRow),
    ...activeVisits.map(visitRow),
    ...activeShifts.map(shiftRow),
  ].sort(byTime);
  const overdue = [
    ...overdueJobs.map(jobRow),
    ...overdueVisits.map(visitRow),
    ...missedShifts.map(shiftRow),
  ].sort(byTime);

  return { active, overdue };
}

/** Live "on now" snapshot as a Telegram message. */
export async function nowMessage(now: Date = new Date()): Promise<string> {
  const snap = await loadNowSnapshot(now);
  const nowLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return formatNowMessage(snap.active, snap.overdue, nowLabel);
}
