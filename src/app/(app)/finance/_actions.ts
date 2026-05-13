"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  applyBillingToVisit,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
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
 * Bulk-billing recalculation for historical rows.
 *
 * Pass `{ scope: "all" }` to recompute every COMPLETED visit and every Job
 * with a known type+site. Pass `{ scope: "missing" }` to only touch rows
 * that don't yet have a billedAmount.
 *
 * Useful right after a rate import — every previously-unbilled row gets a
 * snapshot. Idempotent.
 */
export async function recalculateBilling(
  scope: "all" | "missing" = "missing",
): Promise<RecalcResult> {
  await requireAdmin();

  let visitsBilled = 0;
  let jobsBilled = 0;

  const visitWhere =
    scope === "all"
      ? { status: "COMPLETED" as const, departedAt: { not: null } }
      : {
          status: "COMPLETED" as const,
          departedAt: { not: null },
          billedAmount: null,
        };
  const visits = await prisma.patrolVisit.findMany({
    where: visitWhere,
    select: {
      id: true,
      siteId: true,
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
    const result = await billForSite(
      v.siteId,
      rateService,
      durationMinutes(v.arrivedAt, v.departedAt),
    );
    await applyBillingToVisit(v.id, result);
    if (result.ok) visitsBilled++;
  }

  const jobWhere =
    scope === "all"
      ? { siteId: { not: null } }
      : { siteId: { not: null }, billedAmount: null };
  const jobs = await prisma.job.findMany({
    where: jobWhere,
    select: {
      id: true,
      siteId: true,
      type: true,
      startedAt: true,
      completedAt: true,
    },
    take: 1000,
  });
  for (const j of jobs) {
    if (!j.siteId) continue;
    const rateService = jobTypeToRateService(j.type);
    if (!rateService) continue;
    const result = await billForSite(
      j.siteId,
      rateService,
      durationMinutes(j.startedAt, j.completedAt),
    );
    await applyBillingToJob(j.id, result);
    if (result.ok) jobsBilled++;
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
