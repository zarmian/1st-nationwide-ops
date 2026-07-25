/**
 * Load a single day's activities across jobs, patrol visits and shifts —
 * the same three sources the /activities page merges — and render them for
 * the Telegram bot. Anchored on the SCHEDULED date in UK terms (matching
 * lib/activityWhen), so a job scheduled for the 30th shows on the 30th even
 * if it was closed later.
 */
import { prisma } from "@/lib/db";
import { ukWallClockToUtc } from "@/lib/dates";
import {
  ACTIVITY_KIND_LABEL,
  formatDayActivitiesMessage,
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
  opts?: { siteId?: string },
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

  const [jobs, visits, shifts] = await prisma.$transaction([
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        ...site,
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
      where: { status: { not: "CANCELLED" }, ...site, scheduledAt: range },
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
      where: { ...site, scheduledStartsAt: range },
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
  opts?: { siteId?: string; siteNote?: string },
): Promise<string> {
  const target = resolveDayTarget(dayInput);
  if (!target) {
    return "I can show <b>today</b>, <b>yesterday</b> or <b>tomorrow</b> — try /today or /yesterday.";
  }
  const rows = await loadDayActivities(target, { siteId: opts?.siteId });
  return formatDayActivitiesMessage(rows, target.label, opts?.siteNote);
}
