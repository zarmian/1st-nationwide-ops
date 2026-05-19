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
  // ── Site & site-tied data ───────────────────────────────────────────
  sites: number;
  siteRates: number;
  keySets: number;
  keys: number;
  keyMovements: number;
  patrolSchedules: number;
  patrolVisits: number;
  lockUnlockSchedules: number;
  alarmEvents: number;
  jobs: number;
  shifts: number;
  formSubmissions: number;
  reportReviews: number;
  clientReports: number;
  formTemplatesSiteScope: number;
  accessInstructions: number;
  onboardingPipelines: number;
  // ── Reference data ─────────────────────────────────────────────────
  officers: number; // non-admin users
  admins: number; // admins kept — shown for safety
  officerRates: number;
  shiftsOfficer: number; // duplicate of `shifts` — shown under officer panel for clarity
  notifications: number;
  regions: number;
  partners: number;
  partnerContacts: number;
  customers: number;
  customerContacts: number;
  // ── Activity log ───────────────────────────────────────────────────
  activityLogsAll: number;
  activityLogsSiteScope: number;
};

export async function getResetCounts(): Promise<ResetCounts> {
  await requireAdmin();
  // Single transaction → sequential queries on one connection (Vercel pools 1
  // for the Supabase transaction pooler).
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
    shifts,
    formSubmissions,
    reportReviews,
    clientReports,
    siteRates,
    formTemplatesSiteScope,
    accessInstructions,
    onboardingPipelines,
    officers,
    admins,
    officerRates,
    notifications,
    regions,
    partners,
    partnerContacts,
    customers,
    customerContacts,
    activityLogsAll,
    activityLogsSiteScope,
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
    prisma.shift.count(),
    prisma.formSubmission.count(),
    prisma.reportReview.count(),
    prisma.clientReport.count(),
    prisma.siteRate.count(),
    prisma.formTemplate.count({ where: { scope: "SITE" } }),
    prisma.accessInstruction.count(),
    prisma.onboardingPipeline.count(),
    prisma.user.count({ where: { role: { not: "ADMIN" } } }),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.officerRate.count(),
    prisma.notification.count(),
    prisma.region.count(),
    prisma.partner.count(),
    prisma.partnerContact.count(),
    prisma.customer.count(),
    prisma.customerContact.count(),
    prisma.activityLog.count(),
    prisma.activityLog.count({
      where: { entity: { in: ["Site", "Job", "PatrolVisit", "AlarmEvent"] } },
    }),
  ]);
  return {
    sites,
    siteRates,
    keySets,
    keys,
    keyMovements,
    patrolSchedules,
    patrolVisits,
    lockUnlockSchedules,
    alarmEvents,
    jobs,
    shifts,
    formSubmissions,
    reportReviews,
    clientReports,
    formTemplatesSiteScope,
    accessInstructions,
    onboardingPipelines,
    officers,
    admins,
    officerRates,
    shiftsOfficer: shifts,
    notifications,
    regions,
    partners,
    partnerContacts,
    customers,
    customerContacts,
    activityLogsAll,
    activityLogsSiteScope,
  };
}

export type ResetScope = {
  sites: boolean;
  officers: boolean;
  regions: boolean;
  partners: boolean;
  customers: boolean;
  activities: boolean;
};

export type ResetResult =
  | { ok: true; scope: ResetScope; totalDeleted: number }
  | { ok: false; error: string };

/**
 * Wipe data in dependency order. Each scope can be toggled independently,
 * but reference data (officers/regions/partners/customers) requires the
 * site cascade to be cleared first — Postgres will reject the deletes
 * otherwise because of foreign keys without ON DELETE SetNull/Cascade.
 * If the caller selects reference data without sites, we silently include
 * sites in the cascade.
 *
 * Confirmation must be the literal string "RESET".
 * Admins are never deleted, even when `officers` is selected.
 */
export async function resetData(
  scope: ResetScope,
  confirmation: string,
): Promise<ResetResult> {
  await requireAdmin();
  if (confirmation !== "RESET") {
    return { ok: false, error: "Confirmation phrase must be RESET" };
  }
  const refDataSelected =
    scope.officers || scope.regions || scope.partners || scope.customers;
  if (
    !scope.sites &&
    !scope.activities &&
    !refDataSelected
  ) {
    return { ok: false, error: "Select at least one scope to reset." };
  }

  const effective: ResetScope = {
    ...scope,
    // Reference data resets require sites gone first.
    sites: scope.sites || refDataSelected,
  };

  const before = await getResetCounts();

  await prisma.$transaction(
    async (tx) => {
      // ─── Site & site-tied data ─────────────────────────────────────
      if (effective.sites) {
        await tx.clientReport.deleteMany({});
        await tx.reportReview.deleteMany({});
        await tx.formSubmission.deleteMany({});
        await tx.formTemplate.deleteMany({ where: { scope: "SITE" } });

        await tx.keyMovement.deleteMany({});
        // KeyMovement → Key is Cascade, but defensive: null custody refs
        // so the Key delete doesn't trip on User.keysHeld either way.
        await tx.key.updateMany({ data: { currentHolderUserId: null } });
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
        // Shifts depend on Site (required FK) — must die with sites.
        await tx.shift.deleteMany({});

        // Null Site.defaultResponderId so the later officer wipe is free
        // to delete users; the site row will be gone anyway.
        await tx.site.updateMany({ data: { defaultResponderId: null } });
        await tx.site.deleteMany({});
      }

      // ─── Activity log ─────────────────────────────────────────────
      if (effective.activities) {
        await tx.activityLog.deleteMany({});
      } else if (effective.sites) {
        // Preserve previous behaviour when only sites are being wiped.
        await tx.activityLog.deleteMany({
          where: {
            entity: { in: ["Site", "Job", "PatrolVisit", "AlarmEvent"] },
          },
        });
      }

      // ─── Officers (non-admin users) ───────────────────────────────
      if (effective.officers) {
        // Null every remaining user FK that doesn't auto-clear.
        await tx.region.updateMany({ data: { leadUserId: null } });
        await tx.formTemplate.updateMany({ data: { createdById: null } });
        await tx.formBlueprint.updateMany({ data: { createdById: null } });
        // Notifications & officer rates only reference users — wipe wholesale
        // for a clean slate.
        await tx.notification.deleteMany({});
        await tx.officerRate.deleteMany({});

        await tx.user.deleteMany({ where: { role: { not: "ADMIN" } } });
      }

      // ─── Partners ────────────────────────────────────────────────
      if (effective.partners) {
        // PartnerContact cascades; Site/Job/FormTemplate already gone via
        // site reset (which we forced on above).
        await tx.partner.deleteMany({});
      }

      // ─── Customers ───────────────────────────────────────────────
      if (effective.customers) {
        // CustomerContact cascades; Site/Job/FormTemplate already gone.
        await tx.customer.deleteMany({});
      }

      // ─── Regions ─────────────────────────────────────────────────
      if (effective.regions) {
        // Sites already gone. If officers weren't wiped, null any User.regionId
        // first or the FK will refuse.
        if (!effective.officers) {
          await tx.user.updateMany({ data: { regionId: null } });
        }
        await tx.region.deleteMany({});
      }
    },
    { timeout: 90_000 },
  );

  revalidatePath("/admin/imports/nexus");
  revalidatePath("/admin/imports/sites");
  revalidatePath("/sites");
  revalidatePath("/finance");
  revalidatePath("/keys");
  revalidatePath("/patrols");
  revalidatePath("/dispatch");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/partners");
  revalidatePath("/admin/regions");

  // Best-effort delta: count what was alive before; we don't re-count after to
  // save a round-trip.
  let totalDeleted = 0;
  if (effective.sites) {
    totalDeleted +=
      before.sites +
      before.siteRates +
      before.keySets +
      before.keys +
      before.keyMovements +
      before.patrolSchedules +
      before.patrolVisits +
      before.lockUnlockSchedules +
      before.alarmEvents +
      before.jobs +
      before.shifts +
      before.formSubmissions +
      before.reportReviews +
      before.clientReports +
      before.formTemplatesSiteScope +
      before.accessInstructions +
      before.onboardingPipelines;
  }
  if (effective.activities) {
    totalDeleted += before.activityLogsAll;
  } else if (effective.sites) {
    totalDeleted += before.activityLogsSiteScope;
  }
  if (effective.officers) {
    totalDeleted +=
      before.officers + before.officerRates + before.notifications;
  }
  if (effective.regions) totalDeleted += before.regions;
  if (effective.partners)
    totalDeleted += before.partners + before.partnerContacts;
  if (effective.customers)
    totalDeleted += before.customers + before.customerContacts;

  return { ok: true, scope: effective, totalDeleted };
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
