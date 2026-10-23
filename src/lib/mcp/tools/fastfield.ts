/**
 * FastField matching review for the Claude connector (admin only): how many
 * reports the robot linked or created against those done by hand, and for
 * each one still waiting, what the robot would do with it now (a dry run of
 * the import's own decision — nothing is written) and what work is recorded
 * at its site. No report answers are returned.
 */
import { reviewFastField } from "@/lib/fastfieldImport";
import { resolveDayRange, ukDayOffset, ukIso, ukToday, type ToolContext } from "./common";

export async function reviewFastFieldReports(
  ctx: ToolContext,
  input: { from?: string; to?: string; limit: number },
) {
  const range = resolveDayRange(
    input,
    { from: ukDayOffset(ctx.now, -29), to: ukToday(ctx.now) },
    92,
  );
  const r = await reviewFastField({
    from: range.fromDate,
    to: range.toDate,
    limit: input.limit,
    budgetMs: 40_000,
  });
  return {
    filed: { from: range.from, to: range.to },
    received: r.received,
    linked: r.linked,
    created: r.created,
    setAside: r.setAside,
    waiting: r.waiting,
    waitingCheckedNow: r.checked,
    ...(r.checked < Math.min(r.waiting, input.limit)
      ? { note: "Not every waiting report was checked in time — narrow the dates for the rest." }
      : {}),
    wouldNow: r.wouldNow,
    reports: r.reports.map((row) => ({
      ref: row.ref,
      filed: ukIso(row.filed),
      at: ukIso(row.at),
      form: row.form,
      siteTyped: row.siteTyped,
      site: row.site,
      robotSaid: row.robotSaid,
      now: row.now,
      ...(row.nearby
        ? {
            nearby: {
              activities: row.nearby.activities.map((a) => ({ ...a, at: ukIso(a.at) })),
              shifts: row.nearby.shifts.map((s) => ({ start: ukIso(s.start), end: ukIso(s.end) })),
            },
          }
        : {}),
      ...(row.nearestSite !== undefined ? { nearestSite: row.nearestSite } : {}),
    })),
  };
}
