/**
 * Billing / pay exceptions — completed work that never got priced.
 *
 * Three silent leaks the finance snapshots don't surface on their own:
 *   - completed activity with no customer bill (`billedAmount = null`) — usually
 *     no rate on file for the service, or a PER_HOUR job with no duration;
 *   - our own officer attended but was never paid (`paidAmount = null`);
 * both mean money missing from P&L / payroll until a rate is set and the admin
 * re-runs "Bill missing".
 *
 * Read-only + heuristic: partner-billed rows (reportedViaPartnerApp / partner-
 * handled) are excluded so the list stays actionable. Windowed on the
 * scheduled/accounting date, same as every other finance view.
 */
import { prisma } from "@/lib/db";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

const CAP = 1000;

export type ExceptionRow = {
  kind: "Job" | "Visit" | "Shift";
  id: string;
  siteId: string | null;
  siteName: string;
  typeLabel: string;
  account: string | null;
  officer: string | null;
  date: Date | null;
  needsBill: boolean;
  needsPay: boolean;
};

export type BillingExceptions = {
  rows: ExceptionRow[];
  counts: { needsBill: number; needsPay: number; total: number };
  capped: boolean;
};

const humanize = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export async function loadBillingExceptions(
  from: Date,
  to: Date,
): Promise<BillingExceptions> {
  const [jobs, visits, shifts] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        completedAt: { not: null },
        // Both fragments carry an OR — combine under AND so the date window
        // isn't clobbered by the exception-reason OR.
        AND: [
          jobScheduledRange(from, to),
          {
            OR: [
              { billedAmount: null, reportedViaPartnerApp: false, siteId: { not: null } },
              { paidAmount: null, assignedToUserId: { not: null }, handledByPartnerId: null },
            ],
          },
        ],
      },
      select: {
        id: true,
        type: true,
        typeLabel: true,
        siteId: true,
        billedAmount: true,
        paidAmount: true,
        assignedToUserId: true,
        handledByPartnerId: true,
        reportedViaPartnerApp: true,
        scheduledFor: true,
        completedAt: true,
        site: {
          select: {
            name: true,
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        },
        assignedTo: { select: { name: true } },
      },
      take: CAP,
    }),
    prisma.patrolVisit.findMany({
      where: {
        status: "COMPLETED",
        AND: [
          visitScheduledRange(from, to),
          {
            OR: [
              { billedAmount: null, reportedViaPartnerApp: false },
              { paidAmount: null, officerId: { not: null }, handledByPartnerId: null },
            ],
          },
        ],
      },
      select: {
        id: true,
        siteId: true,
        billedAmount: true,
        paidAmount: true,
        officerId: true,
        handledByPartnerId: true,
        reportedViaPartnerApp: true,
        scheduledAt: true,
        scheduleDate: true,
        patrolSchedule: { select: { kind: true } },
        site: {
          select: {
            name: true,
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        },
        officer: { select: { name: true } },
      },
      take: CAP,
    }),
    prisma.shift.findMany({
      where: {
        status: "COMPLETED",
        recordedByPartner: false,
        ...shiftScheduledRange(from, to),
        OR: [
          { billedAmount: null },
          { paidAmount: null, officerId: { not: null }, handledByPartnerId: null },
        ],
      },
      select: {
        id: true,
        type: true,
        siteId: true,
        billedAmount: true,
        paidAmount: true,
        officerId: true,
        handledByPartnerId: true,
        scheduledStartsAt: true,
        site: {
          select: {
            name: true,
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        },
        officer: { select: { name: true } },
      },
      take: CAP,
    }),
  ]);

  const rows: ExceptionRow[] = [];

  for (const j of jobs) {
    const needsBill =
      j.billedAmount == null && !j.reportedViaPartnerApp && j.siteId != null;
    const needsPay =
      j.paidAmount == null &&
      j.assignedToUserId != null &&
      j.handledByPartnerId == null;
    if (!needsBill && !needsPay) continue;
    rows.push({
      kind: "Job",
      id: j.id,
      siteId: j.siteId,
      siteName: j.site?.name ?? "—",
      typeLabel: j.typeLabel ?? humanize(j.type),
      account: j.site?.customer?.name ?? j.site?.partner?.name ?? null,
      officer: j.assignedTo?.name ?? null,
      date: j.scheduledFor ?? j.completedAt,
      needsBill,
      needsPay,
    });
  }

  for (const v of visits) {
    const needsBill = v.billedAmount == null && !v.reportedViaPartnerApp;
    const needsPay =
      v.paidAmount == null && v.officerId != null && v.handledByPartnerId == null;
    if (!needsBill && !needsPay) continue;
    rows.push({
      kind: "Visit",
      id: v.id,
      siteId: v.siteId,
      siteName: v.site?.name ?? "—",
      typeLabel: v.patrolSchedule?.kind === "VPI" ? "VPI visit" : "Patrol visit",
      account: v.site?.customer?.name ?? v.site?.partner?.name ?? null,
      officer: v.officer?.name ?? null,
      date: v.scheduleDate ?? v.scheduledAt,
      needsBill,
      needsPay,
    });
  }

  for (const s of shifts) {
    const needsBill = s.billedAmount == null;
    const needsPay =
      s.paidAmount == null && s.officerId != null && s.handledByPartnerId == null;
    if (!needsBill && !needsPay) continue;
    rows.push({
      kind: "Shift",
      id: s.id,
      siteId: s.siteId,
      siteName: s.site?.name ?? "—",
      typeLabel: humanize(s.type),
      account: s.site?.customer?.name ?? s.site?.partner?.name ?? null,
      officer: s.officer?.name ?? null,
      date: s.scheduledStartsAt,
      needsBill,
      needsPay,
    });
  }

  rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  const counts = {
    needsBill: rows.filter((r) => r.needsBill).length,
    needsPay: rows.filter((r) => r.needsPay).length,
    total: rows.length,
  };
  const capped =
    jobs.length === CAP || visits.length === CAP || shifts.length === CAP;

  return { rows, counts, capped };
}
