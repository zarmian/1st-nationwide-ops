/**
 * The robot's first shift check (24 Nov 2026), and putting right what it may
 * have undone.
 *
 * Until 24 Nov a report linked to a shift by hand was never checked against
 * the shift's time, and nothing recorded that it had been linked by hand.
 * That day, from 06:30 to 19:30 UTC, the robot's first shift checks moved
 * every report on a shift it didn't fit to another shift at the site, or took
 * it off — very likely some that a person had put there on purpose. Which ones
 * can't be told from today's data: their "Linked by …" notes were overwritten.
 *
 * So Admin → FastField lists every report the robot moved or took off in that
 * window, from the shifts' history (ActivityLog: `fastfield_moved_off`, and
 * `fastfield_unlinked` with `by: "robot"`), with the shift it was on before.
 * A person either puts it back there as a hand link (the robot then leaves it
 * alone) or leaves it as it is (`fastfield_first_check_reviewed`).
 */
import type { FastFieldReportStatus, FastFieldUnlinkBy, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FASTFIELD_RULES_VERSION } from "@/lib/fastfieldRulesVersion";
import { reportTimeText, shiftHoursText, spanText, splitSiaNumber } from "@/lib/fastfield";
import { checkReportOnShift, linkReportToShift } from "@/lib/fastfieldImport";

/** The robot's first shift checks ran in this window (24 Nov 2026, UTC). */
export const FIRST_CHECK_FROM = new Date("2026-11-24T06:30:00Z");
export const FIRST_CHECK_TO = new Date("2026-11-24T19:30:00Z");
/** Most reports listed at once. */
export const FIRST_CHECK_SHOWN = 100;
/** History (entity FastFieldReport): a person put it back or left it. */
export const FIRST_CHECK_REVIEWED = "fastfield_first_check_reviewed";

const ROBOT_ACTIONS = ["fastfield_moved_off", "fastfield_unlinked"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One move or take-off by the robot: the report, and the shift it was on. */
export type FirstCheckEvent = {
  reportId: string;
  shiftId: string;
  what: "moved" | "takenOff";
  at: Date;
};

export type HistoryRow = {
  entityId: string;
  action: string;
  diff: unknown;
  createdAt: Date;
  userId: string | null;
};

/** The robot's moves and take-offs within [from, to] among a shift's history
 *  rows, earliest first. A person's unlink (it has a user, and no
 *  `by: "robot"`) isn't one. */
export function firstCheckEvents(
  rows: HistoryRow[],
  from: Date = FIRST_CHECK_FROM,
  to: Date = FIRST_CHECK_TO,
): FirstCheckEvent[] {
  const out: FirstCheckEvent[] = [];
  for (const r of rows) {
    if (r.userId) continue;
    const at = r.createdAt.getTime();
    if (at < from.getTime() || at > to.getTime()) continue;
    const diff =
      r.diff && typeof r.diff === "object" && !Array.isArray(r.diff) ? (r.diff as Record<string, unknown>) : {};
    const reportId = typeof diff.fastfieldReportId === "string" ? diff.fastfieldReportId : null;
    if (!reportId || !UUID.test(reportId) || !UUID.test(r.entityId)) continue;
    if (r.action === "fastfield_moved_off") {
      out.push({ reportId, shiftId: r.entityId, what: "moved", at: r.createdAt });
    } else if (r.action === "fastfield_unlinked" && diff.by === "robot") {
      out.push({ reportId, shiftId: r.entityId, what: "takenOff", at: r.createdAt });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Per report, the robot's first move or take-off that day — its shift is
 *  where the report was before the robot touched it. */
export function firstEventPerReport(events: FirstCheckEvent[]): Map<string, FirstCheckEvent> {
  const out = new Map<string, FirstCheckEvent>();
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (!out.has(e.reportId)) out.set(e.reportId, e);
  }
  return out;
}

export type FirstCheckState = {
  status: FastFieldReportStatus;
  linkedByHand: boolean;
  shiftId: string | null;
  jobId: string | null;
  patrolVisitId: string | null;
  formSubmissionId: string | null;
};

/** How "Put back" works for a report: `link` — it's free (waiting or set
 *  aside), so it's linked to the shift by hand; `move` — it's on another
 *  shift by the robot's doing, so it moves (with its patrol round) back;
 *  `keep` — the robot put it back on that very shift, so it just becomes a
 *  hand link. Null when it's attached to something else. */
export type PutBackMode = "link" | "move" | "keep";

export function putBackMode(r: FirstCheckState, originalShiftId: string): PutBackMode | null {
  if (r.linkedByHand) return null;
  if (r.status === "UNMATCHED" || r.status === "IGNORED") {
    const free = !r.formSubmissionId && !r.shiftId && !r.jobId && !r.patrolVisitId;
    return free ? "link" : null;
  }
  if (r.status === "LINKED" && r.shiftId && !r.jobId && !r.patrolVisitId) {
    return r.shiftId === originalShiftId ? "keep" : "move";
  }
  return null;
}

/** Why a report isn't listed, or null when it is: a person has dealt with it
 *  (put back or left), it was linked by hand since, or the shift it was on
 *  has been deleted (nothing to put it back on). */
export function firstCheckHidden(a: {
  reviewed: boolean;
  linkedByHand: boolean;
  shiftExists: boolean;
}): "reviewed" | "byHand" | "shiftGone" | null {
  if (a.reviewed) return "reviewed";
  if (a.linkedByHand) return "byHand";
  if (!a.shiftExists) return "shiftGone";
  return null;
}

type ShiftRow = {
  id: string;
  siteId: string;
  officerId: string | null;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
};

const SHIFT_SELECT = {
  id: true,
  siteId: true,
  officerId: true,
  scheduledStartsAt: true,
  scheduledEndsAt: true,
  actualStartedAt: true,
  actualEndedAt: true,
  site: { select: { name: true } },
} as const;

/** A shift's window: the earliest of its scheduled / actual start to the
 *  latest of its ends. */
function windowOf(s: ShiftRow): { start: Date; end: Date } {
  return {
    start: new Date(Math.min(s.scheduledStartsAt.getTime(), (s.actualStartedAt ?? s.scheduledStartsAt).getTime())),
    end: new Date(Math.max(s.scheduledEndsAt.getTime(), (s.actualEndedAt ?? s.scheduledEndsAt).getTime())),
  };
}

const NOUN: Record<string, string> = {
  ALARM_RESPONSE: "callout",
  PATROL: "patrol job",
  LOCK: "lock-up",
  UNLOCK: "unlock",
  KEY_COLLECTION: "key collection",
  KEY_DROPOFF: "key drop-off",
  SURVEY: "survey",
  VPI: "VPI",
  ADHOC: "ad-hoc job",
};

/** Where a report is now, in a few words. */
function nowText(
  r: FirstCheckState & { unlinkedBy: FastFieldUnlinkBy | null; job: { type: string } | null },
  current: (ShiftRow & { site: { name: string } }) | null,
  originalSiteId: string,
): string {
  if (r.status === "LINKED" && r.shiftId) {
    if (!current) return "On a shift that has since been deleted.";
    const where = current.siteId === originalSiteId ? "" : ` at ${current.site.name}`;
    return `On the shift ${shiftHoursText(windowOf(current))}${where}, put there by the robot.`;
  }
  if (r.status === "LINKED" && r.job) return `On a ${NOUN[r.job.type] ?? "job"}.`;
  if (r.status === "LINKED" && r.patrolVisitId) return "On a patrol visit.";
  if (r.status === "LINKED") return "Linked, but what it was on has since been deleted.";
  if (r.status === "CREATED") return "A job was created from it.";
  if (r.status === "IGNORED") return "Set aside.";
  return r.unlinkedBy === "PERSON"
    ? "Waiting in Needs linking (a person took it off)."
    : "Waiting in Needs linking.";
}

export type FirstCheckItem = {
  reportId: string;
  /** The report's matched site, else the site as typed. */
  site: string;
  /** The report's own time ("23 Nov, 22:00–22:20"). */
  reportTime: string;
  form: string;
  officer: string | null;
  /** What the robot did, and when. */
  robot: { what: "moved" | "takenOff"; at: Date };
  /** The shift it was on before. `outside`: why the report doesn't fit it
   *  (null when it does) — a hand link may stay there either way. */
  original: { id: string; hours: string; site: string; outside: string | null };
  /** Where it is now. */
  now: string;
  /** What "Put back" would do; null when it can't (attached elsewhere). */
  mode: PutBackMode | null;
  /** `move`: the shift it would come off. */
  from: { id: string; hours: string } | null;
};

export type FirstCheckReview = {
  /** The newest FIRST_CHECK_SHOWN (or `limit`) reports still to look at. */
  items: FirstCheckItem[];
  /** How many are still to look at in all. */
  total: number;
  /** Not listed because the shift they were on has since been deleted. */
  shiftGone: number;
};

/** The robot's events that day for one report, from the shift history. */
async function eventsFor(reportId: string): Promise<FirstCheckEvent[]> {
  const rows = await prisma.activityLog.findMany({
    where: {
      entity: "Shift",
      action: { in: ROBOT_ACTIONS },
      userId: null,
      createdAt: { gte: FIRST_CHECK_FROM, lte: FIRST_CHECK_TO },
      diff: { path: ["fastfieldReportId"], equals: reportId },
    },
    select: { entityId: true, action: true, diff: true, createdAt: true, userId: true },
  });
  return firstCheckEvents(rows).filter((e) => e.reportId === reportId);
}

async function reviewed(reportId: string): Promise<boolean> {
  const n = await prisma.activityLog.count({
    where: { entity: "FastFieldReport", entityId: reportId, action: FIRST_CHECK_REVIEWED },
  });
  return n > 0;
}

function reviewedRow(
  reportId: string,
  userId: string,
  diff: Prisma.InputJsonValue,
): Prisma.ActivityLogUncheckedCreateInput {
  return { entity: "FastFieldReport", entityId: reportId, action: FIRST_CHECK_REVIEWED, userId, diff };
}

/**
 * The reports still to look at: moved or taken off by the robot that day,
 * not yet put back or left by a person, not linked by hand since, and whose
 * shift still exists. Newest first, at most `limit`.
 */
export async function loadFirstCheckReview(limit: number = FIRST_CHECK_SHOWN): Promise<FirstCheckReview> {
  const history = await prisma.activityLog.findMany({
    where: {
      entity: "Shift",
      action: { in: ROBOT_ACTIONS },
      userId: null,
      createdAt: { gte: FIRST_CHECK_FROM, lte: FIRST_CHECK_TO },
    },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, action: true, diff: true, createdAt: true, userId: true },
  });
  const firsts = firstEventPerReport(firstCheckEvents(history));
  if (firsts.size === 0) return { items: [], total: 0, shiftGone: 0 };
  const ids = Array.from(firsts.keys());

  const [done, reports] = await Promise.all([
    prisma.activityLog.findMany({
      where: { entity: "FastFieldReport", action: FIRST_CHECK_REVIEWED, entityId: { in: ids } },
      select: { entityId: true },
    }),
    prisma.fastFieldReport.findMany({
      where: { id: { in: ids } },
      select: { id: true, linkedByHand: true, submittedAt: true },
    }),
  ]);
  const doneIds = new Set(done.map((d) => d.entityId));
  const originals = new Set(
    (
      await prisma.shift.findMany({
        where: { id: { in: Array.from(new Set(Array.from(firsts.values()).map((e) => e.shiftId))) } },
        select: { id: true },
      })
    ).map((s) => s.id),
  );

  let shiftGone = 0;
  const open: { id: string; submittedAt: Date }[] = [];
  for (const r of reports) {
    const hidden = firstCheckHidden({
      reviewed: doneIds.has(r.id),
      linkedByHand: r.linkedByHand,
      shiftExists: originals.has(firsts.get(r.id)!.shiftId),
    });
    if (hidden === "shiftGone") shiftGone++;
    if (!hidden) open.push(r);
  }
  open.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || a.id.localeCompare(b.id));
  const shown = open.slice(0, limit).map((r) => r.id);
  if (shown.length === 0) return { items: [], total: 0, shiftGone };

  const rows = await prisma.fastFieldReport.findMany({
    where: { id: { in: shown } },
    select: {
      id: true,
      status: true,
      linkedByHand: true,
      shiftId: true,
      jobId: true,
      patrolVisitId: true,
      formSubmissionId: true,
      unlinkedBy: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      answers: true,
      siteText: true,
      officerText: true,
      form: { select: { name: true } },
      site: { select: { name: true } },
      job: { select: { type: true } },
    },
  });
  const shiftIds = new Set<string>();
  for (const r of rows) {
    shiftIds.add(firsts.get(r.id)!.shiftId);
    if (r.shiftId) shiftIds.add(r.shiftId);
  }
  const shifts = new Map(
    (await prisma.shift.findMany({ where: { id: { in: Array.from(shiftIds) } }, select: SHIFT_SELECT })).map(
      (s) => [s.id, s],
    ),
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: FirstCheckItem[] = [];
  for (const id of shown) {
    const r = byId.get(id);
    const event = firsts.get(id)!;
    const original = shifts.get(event.shiftId);
    if (!r || !original) continue;
    const check = checkReportOnShift(r, original);
    const current = r.shiftId ? shifts.get(r.shiftId) ?? null : null;
    const mode = putBackMode(r, original.id);
    items.push({
      reportId: r.id,
      site: r.site?.name ?? r.siteText ?? "Site not given",
      reportTime: reportTimeText(check.span),
      form: r.form.name.trim(),
      officer: r.officerText ? splitSiaNumber(r.officerText).name ?? r.officerText : null,
      robot: { what: event.what, at: event.at },
      original: {
        id: original.id,
        hours: shiftHoursText(check.shift),
        site: original.site.name,
        outside: check.outside,
      },
      now: nowText(r, current, original.siteId),
      mode,
      from: mode === "move" && current ? { id: current.id, hours: shiftHoursText(windowOf(current)) } : null,
    });
  }
  return { items, total: open.length, shiftGone };
}

class Changed extends Error {}

/**
 * Put a report the robot moved or took off that day back on the shift it was
 * on, as a hand link (the robot then leaves it there, fit or not). `shiftId`
 * is the shift the person was shown; it must be the one the history says.
 * A free report is linked there by hand; one on a shift by the robot's doing
 * moves there with its patrol round in one transaction, only if it is still
 * where it was just read. Written on both shifts' history and the report's.
 */
export async function putBackFirstCheck(
  reportId: string,
  shiftId: string,
  by: { userId: string; name: string },
): Promise<{ ok: true; mode: PutBackMode; fromShiftId: string | null } | { ok: false; error: string }> {
  const first = (await eventsFor(reportId))[0];
  if (!first) return { ok: false, error: "The robot didn't move or take off this report on 24 Nov." };
  if (first.shiftId !== shiftId) {
    return { ok: false, error: "This list is out of date. Reload the page and try again." };
  }
  if (await reviewed(reportId)) {
    return { ok: false, error: "Someone has already dealt with this report. Reload the page." };
  }
  const [report, shift] = await Promise.all([
    prisma.fastFieldReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        status: true,
        linkedByHand: true,
        shiftId: true,
        jobId: true,
        patrolVisitId: true,
        formSubmissionId: true,
      },
    }),
    prisma.shift.findUnique({ where: { id: shiftId }, select: SHIFT_SELECT }),
  ]);
  if (!report) return { ok: false, error: "FastField report not found." };
  if (!shift) return { ok: false, error: "That shift has been deleted, so the report can't go back on it." };
  const mode = putBackMode(report, shift.id);
  if (!mode) {
    return {
      ok: false,
      error: report.linkedByHand
        ? "It has been linked by hand since. Reload the page."
        : "It's attached to something else now. Open the report to change it.",
    };
  }
  const note = `Put back on the shift ${shiftHoursText(windowOf(shift))} by ${by.name}: the robot had ${
    first.what === "moved" ? "moved it to another shift" : "taken it off"
  } on 24 Nov.`;

  if (mode === "link") {
    const res = await linkReportToShift(report.id, shift.id, { byHand: true, byUserId: by.userId, note });
    if (!res.ok) return res;
    await prisma.activityLog
      .create({ data: reviewedRow(report.id, by.userId, { decision: "put_back", shiftId: shift.id }) })
      .catch(() => {});
    return { ok: true, mode, fromShiftId: null };
  }

  const fromShiftId = report.shiftId!;
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.fastFieldReport.updateMany({
        where: {
          id: report.id,
          status: "LINKED",
          linkedByHand: false,
          shiftId: fromShiftId,
          formSubmissionId: report.formSubmissionId,
        },
        data: {
          shiftId: shift.id,
          siteId: shift.siteId,
          linkedByHand: true,
          linkedAt: now,
          unlinkedAt: null,
          unlinkedBy: null,
          shiftCheckedAt: now,
          rulesVersion: FASTFIELD_RULES_VERSION,
          note,
        },
      });
      if (claimed.count !== 1) throw new Changed();
      if (mode === "move") {
        if (report.formSubmissionId) {
          await tx.formSubmission.update({
            where: { id: report.formSubmissionId },
            data: { shiftId: shift.id, siteId: shift.siteId },
          });
        }
        await tx.activityLog.create({
          data: {
            entity: "Shift",
            entityId: fromShiftId,
            action: "fastfield_unlinked",
            userId: by.userId,
            diff: { fastfieldReportId: report.id, movedToShiftId: shift.id },
          },
        });
      }
      await tx.activityLog.create({
        data: {
          entity: "Shift",
          entityId: shift.id,
          action: "fastfield_linked",
          userId: by.userId,
          diff: {
            fastfieldReportId: report.id,
            byHand: true,
            firstCheck: true,
            ...(mode === "move" ? { fromShiftId } : {}),
          },
        },
      });
      await tx.activityLog.create({
        data: reviewedRow(report.id, by.userId, { decision: "put_back", shiftId: shift.id }),
      });
    });
  } catch (e) {
    if (e instanceof Changed) {
      return { ok: false, error: "It changed while you were looking. Reload the page and try again." };
    }
    throw e;
  }
  return { ok: true, mode, fromShiftId: mode === "move" ? fromShiftId : null };
}

/** Leave a report where it is: it stops being listed. */
export async function leaveFirstCheck(
  reportId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((await eventsFor(reportId)).length === 0) {
    return { ok: false, error: "The robot didn't move or take off this report on 24 Nov." };
  }
  if (await reviewed(reportId)) return { ok: true };
  await prisma.activityLog.create({ data: reviewedRow(reportId, userId, { decision: "left" }) });
  return { ok: true };
}
