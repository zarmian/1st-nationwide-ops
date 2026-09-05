import { prisma } from "@/lib/db";
import { ukDayString, formatTime } from "@/lib/dates";
import { getJobTypeLabels } from "@/lib/labels";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Warnings for a job that looks like a duplicate of existing work at the same
 * site. Two rules:
 *   1. Another non-cancelled activity at the site within ±1 hour of this one.
 *   2. A second LOCK / UNLOCK at the site on the same UK calendar day.
 * Returns human-readable strings (empty when nothing looks off). The caller
 * decides whether to block or warn — this is advisory only.
 */
export async function findDuplicateJobWarnings(opts: {
  siteId: string;
  type: string;
  at: Date;
  excludeJobId?: string;
}): Promise<string[]> {
  const { siteId, type, at, excludeJobId } = opts;
  const warnings: string[] = [];

  // Candidate window: a day either side, so both the same-day rule and an
  // hour window straddling midnight are covered in one query.
  const from = new Date(at.getTime() - 26 * HOUR_MS);
  const to = new Date(at.getTime() + 26 * HOUR_MS);

  const jobs = await prisma.job.findMany({
    where: {
      siteId,
      status: { not: "CANCELLED" },
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
      OR: [
        { scheduledFor: { gte: from, lte: to } },
        { startedAt: { gte: from, lte: to } },
        { completedAt: { gte: from, lte: to } },
      ],
    },
    select: {
      type: true,
      typeLabel: true,
      scheduledFor: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (jobs.length === 0) return warnings;

  type Row = (typeof jobs)[number];
  const jobTime = (j: Row): Date | null =>
    j.scheduledFor ?? j.startedAt ?? j.completedAt ?? null;

  const labels = await getJobTypeLabels();
  const labelFor = (j: Row) =>
    j.typeLabel || labels[j.type] || j.type.replace(/_/g, " ");

  // Rule 1 — another activity within the hour.
  const near = jobs
    .map((j) => ({ j, t: jobTime(j) }))
    .filter((x): x is { j: Row; t: Date } => x.t != null)
    .filter((x) => Math.abs(x.t.getTime() - at.getTime()) <= HOUR_MS)
    .sort(
      (a, b) =>
        Math.abs(a.t.getTime() - at.getTime()) -
        Math.abs(b.t.getTime() - at.getTime()),
    );
  if (near.length > 0) {
    const n = near[0]!;
    warnings.push(
      `Another activity at this site is within the hour — ${labelFor(n.j)} at ${formatTime(n.t)}.`,
    );
  }

  // Rule 2 — a second lock / unlock the same day.
  if (type === "LOCK" || type === "UNLOCK") {
    const day = ukDayString(at);
    const clash = jobs.some((j) => {
      if (j.type !== type) return false;
      const t = jobTime(j);
      return t != null && ukDayString(t) === day;
    });
    if (clash) {
      warnings.push(
        `There's already a ${type === "LOCK" ? "lock-up" : "unlock"} logged at this site today.`,
      );
    }
  }

  return warnings;
}
