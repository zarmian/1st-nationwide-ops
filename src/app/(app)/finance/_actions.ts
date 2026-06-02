"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  applyBillingToVisit,
  applyPayToJob,
  applyPayToVisit,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";

export type RecalcResult = {
  ok: boolean;
  visitsScanned: number;
  visitsBilled: number;
  jobsScanned: number;
  jobsBilled: number;
  error?: string;
};

/**
 * Bulk-billing recalculation for rows in a date window.
 *
 * - scope="all"      → re-snapshot every COMPLETED visit + every non-cancelled
 *                       Job in the window (overwrites existing snapshots).
 * - scope="missing"  → only touch rows where billedAmount is currently null.
 *
 * Cancelled jobs are always excluded — Restore is the only path that puts
 * billing back on a cancelled job, never a bulk recompute.
 *
 * The date window scopes by the natural "completion" timestamp:
 *   - PatrolVisit.departedAt
 *   - Job.completedAt
 * If `from` / `to` are omitted the window covers everything (legacy
 * behaviour). Idempotent.
 */
export async function recalculateBilling(
  scope: "all" | "missing" = "missing",
  window?: { from?: Date | string; to?: Date | string },
): Promise<RecalcResult> {
  await requireAdmin();

  const from = window?.from ? new Date(window.from) : undefined;
  const to = window?.to ? new Date(window.to) : undefined;

  let visitsBilled = 0;
  let jobsBilled = 0;

  const visitWhere: any = {
    status: "COMPLETED" as const,
    departedAt:
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : { not: null },
  };
  if (scope === "missing") visitWhere.billedAmount = null;

  const visits = await prisma.patrolVisit.findMany({
    where: visitWhere,
    select: {
      id: true,
      siteId: true,
      officerId: true,
      arrivedAt: true,
      departedAt: true,
      formSubmissions: {
        select: { form: true },
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
    take: 1000,
  });
  for (const v of visits) {
    const form = v.formSubmissions[0]?.form ?? "PATROL";
    const rateService = jobTypeToRateService(form);
    if (!rateService) continue;
    const duration = durationMinutes(v.arrivedAt, v.departedAt);
    const bill = await billForSite(v.siteId, rateService, duration);
    await applyBillingToVisit(v.id, bill);
    if (bill.ok) visitsBilled++;
    if (v.officerId) {
      const pay = await payForOfficer(v.officerId, rateService, duration);
      await applyPayToVisit(v.id, pay);
    }
  }

  const jobWhere: any = {
    siteId: { not: null },
    status: { not: "CANCELLED" },
  };
  if (from || to) {
    jobWhere.completedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (scope === "missing") jobWhere.billedAmount = null;

  const jobs = await prisma.job.findMany({
    where: jobWhere,
    select: {
      id: true,
      siteId: true,
      type: true,
      assignedToUserId: true,
      startedAt: true,
      completedAt: true,
    },
    take: 1000,
  });
  for (const j of jobs) {
    if (!j.siteId) continue;
    const rateService = jobTypeToRateService(j.type);
    if (!rateService) continue;
    const duration = durationMinutes(j.startedAt, j.completedAt);
    const bill = await billForSite(j.siteId, rateService, duration);
    await applyBillingToJob(j.id, bill);
    if (bill.ok) jobsBilled++;
    if (j.assignedToUserId) {
      const pay = await payForOfficer(j.assignedToUserId, rateService, duration);
      await applyPayToJob(j.id, pay);
    }
  }

  revalidatePath("/finance");
  revalidatePath("/dispatch");
  return {
    ok: true,
    visitsScanned: visits.length,
    visitsBilled,
    jobsScanned: jobs.length,
    jobsBilled,
  };
}
