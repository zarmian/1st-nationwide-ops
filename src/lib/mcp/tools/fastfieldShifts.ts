/**
 * FastField reports on shifts, for the Claude connector (admin only).
 *
 * - review_shift_rounds (read): each static / dog-handler shift in a window
 *   with the FastField reports on it, checked against the owner's rules — the
 *   report's typed time fits the shift (with the allowance), it's at the
 *   shift's site, whose officer it names, and what the robot's rules would do
 *   with it — plus waiting reports that fit the shift. No report answers.
 * - link_fastfield_report_to_shift / unlink_fastfield_report_from_shift
 *   (write, scope `fastfield:link`, ticked by an admin on the consent screen):
 *   change which shift a report is on, exactly as a person would on Admin →
 *   FastField — a hand link the robot leaves alone, recorded in the shift's
 *   history with the admin's name and the reason given. Reports on a job or a
 *   patrol visit aren't touched here.
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit";
import { SHIFT_GRACE_MIN, reportTimeText, shiftHoursText } from "@/lib/fastfield";
import {
  checkReportOnShift,
  linkReportToShift,
  reviewShiftRounds,
  unlinkReportFromShift,
} from "@/lib/fastfieldImport";
import {
  ToolInputError,
  isUuid,
  matchSites,
  resolveDayRange,
  ukDayOffset,
  ukIso,
  ukToday,
  type ToolContext,
} from "./common";

const ref = (id: string) => id.slice(0, 8);

export async function reviewShiftRoundsTool(
  ctx: ToolContext,
  input: { from?: string; to?: string; site?: string; onlyProblems?: boolean; limit: number },
) {
  const range = resolveDayRange(input, { from: ukDayOffset(ctx.now, -6), to: ukToday(ctx.now) }, 31);
  const sites = input.site ? await matchSites(input.site) : null;
  const r = await reviewShiftRounds({
    from: range.fromDate,
    to: range.toDate,
    siteIds: sites?.ids,
    onlyProblems: input.onlyProblems ?? true,
    limit: input.limit,
  });
  return {
    shiftsStarting: { from: range.from, to: range.to },
    ...(sites ? { sitesMatched: sites.names } : {}),
    shifts: r.shifts,
    rounds: r.rounds,
    shiftsWithProblems: r.withProblems,
    allowanceMinutes: SHIFT_GRACE_MIN,
    ...(r.more ? { note: "More shifts than shown — narrow the dates or the site." } : {}),
    rows: r.rows.map((row) => ({
      shiftId: row.shift.id,
      site: row.shift.siteName,
      type: row.shift.type,
      status: row.shift.status,
      scheduled: { start: ukIso(row.shift.scheduled.start), end: ukIso(row.shift.scheduled.end) },
      hours: shiftHoursText(row.shift.window),
      officer: row.shift.officer,
      ...(row.shift.partner ? { partner: true } : {}),
      problems: row.problems,
      rounds: row.rounds.map((x) => ({
        reportId: x.reportId,
        ref: ref(x.reportId),
        typed: x.typed ? reportTimeText(x.typed) : null,
        fits: x.outside === null,
        ...(x.outside ? { outside: x.outside } : {}),
        byHand: x.byHand,
        officerTyped: x.officerTyped,
        officerIsShiftOfficer: x.officerIsShiftOfficer,
        siteMatches: x.siteMatches,
        rules:
          x.rule.kind === "move"
            ? { would: "move", toShiftId: x.rule.toShiftId, toHours: shiftHoursText(x.rule.to) }
            : { would: x.rule.kind },
      })),
      waitingThatFit: row.waitingThatFit.map((w) => ({
        reportId: w.reportId,
        ref: ref(w.reportId),
        typed: reportTimeText(w.typed),
        ...(w.unlinkedBy ? { takenOffBy: w.unlinkedBy === "PERSON" ? "a person" : "the robot" } : {}),
      })),
    })),
  };
}

function reasonOf(text: string): string {
  const reason = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!reason) throw new ToolInputError("Say briefly why — it goes in the shift's history.");
  return reason;
}

/** Put a FastField report on a shift — moving it off the shift it's on, if
 *  any — as a hand link in the admin's name. */
export async function linkReportToShiftTool(
  ctx: ToolContext,
  input: { reportId: string; shiftId: string; reason: string },
) {
  const reportId = input.reportId.trim();
  const shiftId = input.shiftId.trim();
  if (!isUuid(reportId) || !isUuid(shiftId)) {
    throw new ToolInputError("Use the full reportId and shiftId (from review_shift_rounds).");
  }
  const reason = reasonOf(input.reason);
  const [report, shift] = await Promise.all([
    prisma.fastFieldReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, shiftId: true, jobId: true, patrolVisitId: true, submittedAt: true, answers: true },
    }),
    prisma.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        officerId: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        actualStartedAt: true,
        actualEndedAt: true,
        site: { select: { name: true } },
      },
    }),
  ]);
  if (!report) throw new ToolInputError("There's no FastField report with that id.");
  if (!shift) throw new ToolInputError("There's no shift with that id.");
  if (report.status === "LINKED" && report.shiftId === shift.id) {
    return { changed: false, message: "That report is already on that shift." };
  }
  if (report.jobId || report.patrolVisitId || report.status === "CREATED") {
    throw new ToolInputError(
      "That report is on a job or a patrol visit, not a shift. Change that in the app (Admin → FastField → the report).",
    );
  }
  const by = `${ctx.principal.userName} (via Claude)`;
  let movedFrom: string | null = null;
  if (report.status === "LINKED" && report.shiftId) {
    const off = await unlinkReportFromShift(report.id, by);
    if (!off.ok) return { changed: false, message: off.error };
    movedFrom = report.shiftId;
    await logActivity({
      entity: "Shift",
      entityId: movedFrom,
      action: "fastfield_unlinked",
      userId: ctx.principal.userId,
      diff: { fastfieldReportId: report.id, via: "claude", reason, movedTo: shift.id },
    });
  }
  const res = await linkReportToShift(report.id, shift.id, {
    byHand: true,
    byUserId: ctx.principal.userId,
    note: `Linked to this shift by ${by}: ${reason}`,
  });
  if (!res.ok) {
    return {
      changed: movedFrom != null,
      message:
        res.error +
        (movedFrom ? " It was taken off its old shift and now waits in Needs linking for a person." : ""),
    };
  }
  const check = checkReportOnShift(report, shift);
  return {
    changed: true,
    report: ref(report.id),
    shift: { id: shift.id, site: shift.site.name, hours: shiftHoursText(check.shift) },
    ...(movedFrom ? { movedFrom } : {}),
    fits: check.outside === null,
    ...(check.outside ? { outside: check.outside } : {}),
    linkedByHand: true,
  };
}

/** Take a FastField report off its shift, in the admin's name: it waits in
 *  Needs linking and the robot won't link it again. */
export async function unlinkReportFromShiftTool(
  ctx: ToolContext,
  input: { reportId: string; reason: string },
) {
  const reportId = input.reportId.trim();
  if (!isUuid(reportId)) throw new ToolInputError("Use the full reportId (from review_shift_rounds).");
  const reason = reasonOf(input.reason);
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: { id: true, status: true, shiftId: true },
  });
  if (!report) throw new ToolInputError("There's no FastField report with that id.");
  if (report.status !== "LINKED" || !report.shiftId) {
    throw new ToolInputError("That report isn't on a shift.");
  }
  const res = await unlinkReportFromShift(report.id, `${ctx.principal.userName} (via Claude)`);
  if (!res.ok) return { changed: false, message: res.error };
  await logActivity({
    entity: "Shift",
    entityId: report.shiftId,
    action: "fastfield_unlinked",
    userId: ctx.principal.userId,
    diff: { fastfieldReportId: report.id, via: "claude", reason },
  });
  return {
    changed: true,
    report: ref(report.id),
    fromShift: report.shiftId,
    nowWaits: "in Needs linking — the robot won't link it again; a person (or this tool) links it",
    ...(res.check?.length ? { check: res.check } : {}),
  };
}
