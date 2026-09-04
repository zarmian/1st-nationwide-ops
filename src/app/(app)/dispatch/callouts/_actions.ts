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
import { logActivity } from "@/lib/audit";
import { parseUkDateTimeLocal } from "@/lib/dates";

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
    typeLabel: formData.get("typeLabel")?.toString() || null,
    source: formData.get("source")?.toString() ?? "ALARM",
    handlerKind: formData.get("handlerKind")?.toString() ?? "officer",
    officerId: formData.get("officerId")?.toString() || null,
    handlerPartnerId: formData.get("handlerPartnerId")?.toString() || null,
    handedOffAt: formData.get("handedOffAt")?.toString() || null,
    partnerOfficerName: formData.get("partnerOfficerName")?.toString() || null,
    startedAt: formData.get("startedAt")?.toString() || null,
    completedAt: formData.get("completedAt")?.toString() || null,
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
  const startedAt = parseUkDateTimeLocal(d.startedAt);
  const completedAt = parseUkDateTimeLocal(d.completedAt);
  const handedOffAt = parseUkDateTimeLocal(d.handedOffAt);

  // Dispatcher backdate cap. Anchor on whichever time the dispatcher gave
  // — startedAt for officer flow, handedOffAt for partner flow.
  const anchorForBackdate = startedAt ?? handedOffAt;
  if (anchorForBackdate) {
    const backdateErr = checkBackdateAllowed(anchorForBackdate, me.role as any);
    if (backdateErr) {
      return {
        error: backdateErr,
        fieldErrors: {
          [d.handlerKind === "partner" ? "handedOffAt" : "startedAt"]: [
            "Too far in the past",
          ],
        },
      };
    }
  }

  const site = await prisma.site.findUnique({
    where: { id: d.siteId },
    select: { id: true, customerId: true, partnerId: true, active: true },
  });
  if (!site) {
    return { error: "Site not found.", fieldErrors: { siteId: ["Unknown"] } };
  }
  if (!site.active) {
    return {
      error: "Site is inactive.",
      fieldErrors: { siteId: ["Site is not currently active"] },
    };
  }

  let officerId: string | null = null;
  let handlerPartnerId: string | null = null;

  if (d.handlerKind === "officer") {
    const officer = await prisma.user.findUnique({
      where: { id: d.officerId! },
      select: { id: true, role: true, active: true },
    });
    if (!officer) {
      return { error: "Officer not found.", fieldErrors: { officerId: ["Unknown"] } };
    }
    if (!officer.active) {
      return {
        error: "Officer is inactive.",
        fieldErrors: { officerId: ["Officer is not currently active"] },
      };
    }
    officerId = officer.id;
  } else {
    const partner = await prisma.partner.findUnique({
      where: { id: d.handlerPartnerId! },
      select: { id: true, role: true, active: true },
    });
    if (!partner) {
      return {
        error: "Partner not found.",
        fieldErrors: { handlerPartnerId: ["Unknown"] },
      };
    }
    if (!partner.active) {
      return {
        error: "Partner is inactive.",
        fieldErrors: { handlerPartnerId: ["Partner is not currently active"] },
      };
    }
    if (partner.role !== "SUBCONTRACTOR" && partner.role !== "BOTH") {
      return {
        error: "Only subcontractor partners (Nexus, Keyholding Co) can take a sub'd job.",
        fieldErrors: { handlerPartnerId: ["Not a subcontracting partner"] },
      };
    }
    handlerPartnerId = partner.id;
  }

  const created = await prisma.job.create({
    data: {
      type: d.type as any,
      typeLabel: d.typeLabel ?? null,
      source: d.source as any,
      status: "APPROVED" as any,
      siteId: d.siteId,
      customerId: site.customerId,
      partnerId: site.partnerId,
      responderType:
        d.handlerKind === "partner" ? ("PARTNER" as any) : ("INTERNAL_OFFICER" as any),
      assignedToUserId: officerId,
      handledByPartnerId: handlerPartnerId,
      handedOffAt,
      externalResponder:
        d.handlerKind === "partner" ? d.partnerOfficerName ?? null : null,
      startedAt,
      completedAt,
      notes: d.notes,
      recordedByUserId: me.id,
      excludeFromClientReport: d.excludeFromClientReport,
      partnerReportRef: d.partnerReportRef,
    },
    select: { id: true, siteId: true },
  });

  // Billing snapshot still applies (we charge the customer either way).
  // Officer pay only when WE attended.
  const rateService = jobTypeToRateService(d.type);
  if (rateService) {
    // Retrospective callout — no schedule, so the accounting date is when it
    // was completed.
    const at = completedAt;
    const bill = await billForSite(d.siteId, rateService);
    if (bill.ok) await applyBillingToJob(created.id, bill, at);
    if (officerId) {
      const pay = await payForOfficer(officerId, rateService);
      if (pay.ok) await applyPayToJob(created.id, pay, at);
    }
  }

  await logActivity({
    entity: "Job",
    entityId: created.id,
    action: "recorded",
    userId: me.id,
  });

  revalidatePath("/dispatch");
  revalidatePath("/activities");
  revalidatePath(`/sites/${d.siteId}`);
  redirect("/dispatch");
}
