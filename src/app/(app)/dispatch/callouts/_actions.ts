"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  applyPayToJob,
  billForSite,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";
import { CalloutInput, checkBackdateAllowed } from "@/lib/dispatcherCallout";

/**
 * Dispatcher-recorded callouts.
 *
 * Bypasses the officer /submit + admin review pipeline: a dispatcher
 * types in a callout that's already been performed, and the Job lands
 * at APPROVED. Used for record-keeping when the officer didn't fill
 * the in-app form (e.g. phone callout, retroactive entry).
 *
 * Pay basis: per-callout flat fee from OfficerRate (unit=PER_VISIT)
 * for the matching service. Billing: SiteRate for the same service.
 * Both look-ups happen post-create via the standard helpers — no
 * special-case pricing path. Validation lives in lib/dispatcherCallout
 * so it can be unit-tested without DB/auth side effects.
 */

export type CalloutState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseForm(formData: FormData) {
  return CalloutInput.safeParse({
    siteId: formData.get("siteId")?.toString() ?? "",
    type: formData.get("type")?.toString() ?? "ALARM_RESPONSE",
    source: formData.get("source")?.toString() ?? "ALARM",
    officerId: formData.get("officerId")?.toString() ?? "",
    startedAt: formData.get("startedAt")?.toString() ?? "",
    completedAt: formData.get("completedAt")?.toString() ?? "",
    notes: formData.get("notes")?.toString() || null,
    excludeFromClientReport: formData.get("excludeFromClientReport") === "on",
    partnerReportRef: formData.get("partnerReportRef")?.toString() || null,
  });
}

export async function recordDispatcherCallout(
  _prev: CalloutState,
  formData: FormData,
): Promise<CalloutState> {
  const me = await requireStaff();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const startedAt = new Date(d.startedAt);
  const completedAt = new Date(d.completedAt);

  // Dispatcher backdate cap (admin bypass — they may be entering historical
  // records during rollout or fixing data after the fact).
  const backdateErr = checkBackdateAllowed(startedAt, me.role as any);
  if (backdateErr) {
    return {
      error: backdateErr,
      fieldErrors: { startedAt: ["Too far in the past"] },
    };
  }

  const [site, officer] = await Promise.all([
    prisma.site.findUnique({
      where: { id: d.siteId },
      select: { id: true, customerId: true, partnerId: true, active: true },
    }),
    prisma.user.findUnique({
      where: { id: d.officerId },
      select: { id: true, role: true, active: true },
    }),
  ]);

  if (!site) {
    return { error: "Site not found.", fieldErrors: { siteId: ["Unknown"] } };
  }
  if (!site.active) {
    return {
      error: "Site is inactive.",
      fieldErrors: { siteId: ["Site is not currently active"] },
    };
  }
  if (!officer) {
    return { error: "Officer not found.", fieldErrors: { officerId: ["Unknown"] } };
  }
  if (!officer.active) {
    return {
      error: "Officer is inactive.",
      fieldErrors: { officerId: ["Officer is not currently active"] },
    };
  }

  const created = await prisma.job.create({
    data: {
      type: d.type as any,
      source: d.source as any,
      status: "APPROVED" as any,
      siteId: d.siteId,
      customerId: site.customerId,
      partnerId: site.partnerId,
      responderType: "INTERNAL_OFFICER" as any,
      assignedToUserId: d.officerId,
      startedAt,
      completedAt,
      notes: d.notes,
      recordedByUserId: me.id,
      excludeFromClientReport: d.excludeFromClientReport,
      partnerReportRef: d.partnerReportRef,
    },
    select: { id: true, siteId: true },
  });

  // Snapshot billing + pay. Pay basis is per-callout (OfficerRate
  // PER_VISIT amount); billing is whatever SiteRate holds for that
  // service. Both no-op silently if no rate is configured.
  const rateService = jobTypeToRateService(d.type);
  if (rateService) {
    const bill = await billForSite(d.siteId, rateService);
    if (bill.ok) await applyBillingToJob(created.id, bill);
    const pay = await payForOfficer(d.officerId, rateService);
    if (pay.ok) await applyPayToJob(created.id, pay);
  }

  revalidatePath("/dispatch");
  revalidatePath("/activities");
  revalidatePath(`/sites/${d.siteId}`);
  redirect("/dispatch");
}
