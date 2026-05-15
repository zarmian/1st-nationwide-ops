"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  previewNexusImport,
  runNexusImport,
  type ImportSkip,
} from "@/lib/nexusImport";


export type ResetCounts = {
  sites: number;
  keySets: number;
  keys: number;
  keyMovements: number;
  patrolSchedules: number;
  patrolVisits: number;
  lockUnlockSchedules: number;
  alarmEvents: number;
  jobs: number;
  formSubmissions: number;
  reportReviews: number;
  clientReports: number;
  siteRates: number;
  formTemplatesSiteScope: number;
  accessInstructions: number;
  onboardingPipelines: number;
  activityLogs: number;
};

export async function getResetCounts(): Promise<ResetCounts> {
  await requireAdmin();
  // $transaction with the array form runs queries sequentially over a single
  // connection — important on Vercel where Prisma defaults to a pool of 1
  // against the Supabase transaction pooler. Promise.all here would queue
  // and time out at 10s.
  const [
    sites,
    keySets,
    keys,
    keyMovements,
    patrolSchedules,
    patrolVisits,
    lockUnlockSchedules,
    alarmEvents,
    jobs,
    formSubmissions,
    reportReviews,
    clientReports,
    siteRates,
    formTemplatesSiteScope,
    accessInstructions,
    onboardingPipelines,
    activityLogs,
  ] = await prisma.$transaction([
    prisma.site.count(),
    prisma.keySet.count(),
    prisma.key.count(),
    prisma.keyMovement.count(),
    prisma.patrolSchedule.count(),
    prisma.patrolVisit.count(),
    prisma.lockUnlockSchedule.count(),
    prisma.alarmEvent.count(),
    prisma.job.count(),
    prisma.formSubmission.count(),
    prisma.reportReview.count(),
    prisma.clientReport.count(),
    prisma.siteRate.count(),
    prisma.formTemplate.count({ where: { scope: "SITE" } }),
    prisma.accessInstruction.count(),
    prisma.onboardingPipeline.count(),
    prisma.activityLog.count({
      where: { entity: { in: ["Site", "Job", "PatrolVisit", "AlarmEvent"] } },
    }),
  ]);
  return {
    sites,
    keySets,
    keys,
    keyMovements,
    patrolSchedules,
    patrolVisits,
    lockUnlockSchedules,
    alarmEvents,
    jobs,
    formSubmissions,
    reportReviews,
    clientReports,
    siteRates,
    formTemplatesSiteScope,
    accessInstructions,
    onboardingPipelines,
    activityLogs,
  };
}

export type ResetResult =
  | { ok: true; deleted: ResetCounts }
  | { ok: false; error: string };

/**
 * Wipes site-level data in dependency order. Keeps users, customers,
 * partners, regions, form templates (non-site scope), and blueprints.
 *
 * Confirmation must be the literal string "RESET".
 */
export async function resetSiteData(
  confirmation: string,
): Promise<ResetResult> {
  await requireAdmin();
  if (confirmation !== "RESET") {
    return { ok: false, error: "Confirmation phrase must be RESET" };
  }
  const before = await getResetCounts();

  // Order matters — delete leaves first, then walk back up the FK tree.
  // Wrapped in a single transaction so a partial failure rolls back.
  await prisma.$transaction(
    async (tx) => {
      await tx.clientReport.deleteMany({});
      await tx.reportReview.deleteMany({});
      await tx.formSubmission.deleteMany({});
      await tx.formTemplate.deleteMany({ where: { scope: "SITE" } });

      await tx.keyMovement.deleteMany({});
      // KeyMovement → Key has Cascade, but defensive: clear holders so the
      // Key delete doesn't trip on FK from User.keysHeld either way.
      await tx.key.updateMany({
        data: { currentHolderUserId: null },
      });
      await tx.key.deleteMany({});
      await tx.keySet.deleteMany({});

      await tx.patrolVisit.deleteMany({});
      await tx.patrolSchedule.deleteMany({});
      await tx.lockUnlockSchedule.deleteMany({});
      await tx.accessInstruction.deleteMany({});
      await tx.alarmEvent.deleteMany({});
      await tx.onboardingPipeline.deleteMany({});
      await tx.job.deleteMany({});
      await tx.siteRate.deleteMany({});

      await tx.activityLog.deleteMany({
        where: { entity: { in: ["Site", "Job", "PatrolVisit", "AlarmEvent"] } },
      });

      await tx.site.deleteMany({});
    },
    { timeout: 60_000 },
  );

  revalidatePath("/admin/imports/nexus");
  revalidatePath("/sites");
  revalidatePath("/finance");
  revalidatePath("/keys");
  revalidatePath("/patrols");

  return { ok: true, deleted: before };
}

export type PreviewResult =
  | {
      ok: true;
      read: number;
      toCreate: number;
      toUpdate: number;
      ratesToWrite: number;
      skipped: ImportSkip[];
    }
  | { ok: false; error: string };

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  await requireAdmin();
  const file = formData.get("csv") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  const text = await file.text();
  try {
    const result = await previewNexusImport(prisma, text);
    return {
      ok: true,
      read: result.read,
      toCreate: result.toCreate,
      toUpdate: result.toUpdate,
      ratesToWrite: result.ratesToWrite,
      skipped: result.skipped,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Preview failed" };
  }
}

export type CommitResult =
  | {
      ok: true;
      created: number;
      updated: number;
      ratesWritten: number;
      skipped: ImportSkip[];
    }
  | { ok: false; error: string };

export async function commitImport(formData: FormData): Promise<CommitResult> {
  await requireAdmin();
  const file = formData.get("csv") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  const text = await file.text();
  try {
    const result = await runNexusImport(prisma, text);
    revalidatePath("/sites");
    revalidatePath("/finance");
    revalidatePath("/admin/imports/nexus");
    return {
      ok: true,
      created: result.created,
      updated: result.updated,
      ratesWritten: result.ratesWritten,
      skipped: result.skipped,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Import failed" };
  }
}
