import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate, ukDayPlus, ukDayString, ukWallClockToUtc } from "@/lib/dates";
import { reportDateInstant, SHURGARD_REPORT_KEY } from "@/lib/reports/clientReportDelivery";
import type { UkDay } from "@/lib/reports/shurgardReport";

/**
 * Whether a FastField report attached to an activity has already gone to the
 * client, and how. The robot never moves or takes off such a report on its
 * own; a person still can, and is told it was already sent.
 *
 * It counts as sent when:
 *  - its review has client reports (sent from the review queue), or
 *  - the daily client email (`deliverShurgardReport`) was sent (status SENT)
 *    for a day that covered its activity, after the report was attached. The
 *    email shows each completed static-guarding shift with photos from the
 *    shift's rounds, and the client's completed callouts and lock-ups; which
 *    activities a day's email covers is mirrored from `loadShurgardReport`
 *    (src/lib/reports/shurgardReport.ts) below — keep the two in step.
 *
 * Patrol visits aren't in the daily email, so only client reports count for
 * them. The client portal, which shows attached reports whenever the client
 * looks, isn't counted.
 */
export async function sentToClient(
  report: { id: string; formSubmissionId: string | null },
  db: Pick<PrismaClient, "formSubmission" | "customer" | "clientReportSend"> = prisma,
): Promise<{ sent: boolean; how?: string }> {
  if (!report.formSubmissionId) return { sent: false };
  const sub = await db.formSubmission.findUnique({
    where: { id: report.formSubmissionId },
    select: {
      review: { select: { _count: { select: { clientReports: true } } } },
      fastfieldReport: { select: { linkedAt: true } },
      shift: {
        select: {
          type: true,
          status: true,
          scheduledStartsAt: true,
          site: { select: { customerId: true } },
        },
      },
      job: {
        select: {
          type: true,
          status: true,
          scheduledFor: true,
          completedAt: true,
          site: { select: { customerId: true } },
        },
      },
    },
  });
  if (!sub) return { sent: false };
  if ((sub.review?._count.clientReports ?? 0) > 0) return { sent: true, how: "in a client report" };

  const activity: DailyReportActivity | null = sub.shift
    ? {
        kind: "shift",
        type: sub.shift.type,
        status: sub.shift.status,
        at: sub.shift.scheduledStartsAt,
        customerId: sub.shift.site.customerId,
      }
    : sub.job
      ? {
          kind: "job",
          type: sub.job.type,
          status: sub.job.status,
          // jobScheduledRange: the scheduled time, else when it was completed.
          at: sub.job.scheduledFor ?? sub.job.completedAt,
          completedAt: sub.job.completedAt,
          customerId: sub.job.site?.customerId ?? null,
        }
      : null;
  if (!activity?.at || !activity.customerId) return { sent: false };
  const days = dailyReportDaysFor(activity.at);
  if (days.length === 0) return { sent: false };

  // The same customers loadShurgardReport looks up for the emailed report.
  const [main, access] = await Promise.all([
    db.customer.findFirst({
      where: { name: { contains: "Shurgard", mode: "insensitive" } },
      select: { id: true },
    }),
    db.customer.findFirst({
      where: { name: { contains: "Access", mode: "insensitive" } },
      select: { id: true },
    }),
  ]);
  if (!inDailyReport(activity, { main: main?.id ?? null, alsoGuarding: access?.id ?? null })) {
    return { sent: false };
  }

  const linkedAt = sub.fastfieldReport?.linkedAt ?? null;
  const send = await db.clientReportSend.findFirst({
    where: {
      reportKey: SHURGARD_REPORT_KEY,
      status: "SENT",
      OR: days.map((d) => {
        const { from, to } = dailyReportWindow(d);
        return { reportDate: { gte: from, lte: to } };
      }),
      // The email is put together just before its send row is made, so a
      // report attached after that wasn't in it. (No linkedAt: assume it was.)
      ...(linkedAt ? { createdAt: { gte: linkedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { reportDate: true },
  });
  if (!send) return { sent: false };
  return { sent: true, how: `in the daily client email for ${formatDate(send.reportDate)}` };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stretch a day's email covers (loadShurgardReport, alreadySentForDay):
 *  from UK midnight, 24 hours less a millisecond. */
export function dailyReportWindow(day: UkDay): { from: Date; to: Date } {
  const from = ukWallClockToUtc(day.year, day.month, day.day, 0, 0);
  return { from, to: new Date(from.getTime() + DAY_MS - 1) };
}

/**
 * The report days whose email covers an activity at `at` (a shift's scheduled
 * start; a job's scheduled time, else its completion). Normally its own UK
 * day. A day is always read as 24 hours, as the email does, so around the
 * clock changes the hour after the short March day is in two days' emails,
 * and the last hour of the long October day is in none.
 */
export function dailyReportDaysFor(at: Date): UkDay[] {
  const [year, month, day] = ukDayString(at).split("-").map(Number);
  const own: UkDay = { year, month, day };
  const before = ukDayPlus(reportDateInstant(own), -1);
  return [before, own].filter((d) => {
    const w = dailyReportWindow(d);
    return at.getTime() >= w.from.getTime() && at.getTime() <= w.to.getTime();
  });
}

export type DailyReportActivity =
  | {
      kind: "shift";
      type: string;
      status: string;
      at: Date | null;
      customerId: string | null;
    }
  | {
      kind: "job";
      type: string;
      status: string;
      at: Date | null;
      completedAt: Date | null;
      customerId: string | null;
    };

/**
 * Whether the daily email lists an activity (loadShurgardReport, for the
 * emailed report): completed static-guarding shifts at the main client's or
 * the other storage client's sites (`alsoGuarding`); the main client's
 * completed, not cancelled callouts, lock-ups and other jobs; and completed,
 * not cancelled static-guarding callouts at either client's sites.
 */
export function inDailyReport(
  a: DailyReportActivity,
  clients: { main: string | null; alsoGuarding: string | null },
): boolean {
  if (!a.customerId) return false;
  const guardingClients = [clients.main, clients.alsoGuarding].filter((x): x is string => !!x);
  if (a.kind === "shift") {
    return a.type === "STATIC_GUARDING" && a.status === "COMPLETED" && guardingClients.includes(a.customerId);
  }
  if (a.status === "CANCELLED" || !a.completedAt) return false;
  if (a.type === "STATIC_GUARDING_SHIFT") return guardingClients.includes(a.customerId);
  return a.customerId === clients.main;
}
