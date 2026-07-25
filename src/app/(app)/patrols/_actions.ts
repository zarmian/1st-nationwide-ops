"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireStaff } from "@/lib/authz";
import { parseUkDateTimeLocal } from "@/lib/dates";
import {
  applyBillingToVisit,
  applyPayToVisit,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";
import { notifyAssignedOfficerOfJob } from "@/lib/telegramNotify";

const ReassignInput = z.object({
  scheduleId: z.string().uuid(),
  officerId: z.string().uuid().or(z.literal("")).nullable(),
});

export async function reassignSchedule(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = ReassignInput.safeParse({
    scheduleId: formData.get("scheduleId")?.toString() ?? "",
    officerId: formData.get("officerId")?.toString() ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const officerId =
    parsed.data.officerId && parsed.data.officerId !== ""
      ? parsed.data.officerId
      : null;
  await prisma.patrolSchedule.update({
    where: { id: parsed.data.scheduleId },
    data: { assignedOfficerId: officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function toggleScheduleActive(
  scheduleId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  await requireStaff();
  await prisma.patrolSchedule.update({
    where: { id: scheduleId },
    data: { active },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function reassignVisit(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const visitId = formData.get("visitId")?.toString();
  const officerId = formData.get("officerId")?.toString() || "";
  if (!visitId) return { ok: false, error: "Missing visit id" };
  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: { officerId: officerId === "" ? null : officerId },
  });
  revalidatePath("/patrols");
  revalidatePath("/dispatch");
  revalidatePath("/activities");
  return { ok: true };
}

export async function reassignLockUnlockSchedule(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = ReassignInput.safeParse({
    scheduleId: formData.get("scheduleId")?.toString() ?? "",
    officerId: formData.get("officerId")?.toString() ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const officerId =
    parsed.data.officerId && parsed.data.officerId !== ""
      ? parsed.data.officerId
      : null;
  await prisma.lockUnlockSchedule.update({
    where: { id: parsed.data.scheduleId },
    data: { assignedOfficerId: officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function reassignJob(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const jobId = formData.get("jobId")?.toString();
  const officerId = formData.get("officerId")?.toString() || "";
  if (!jobId) return { ok: false, error: "Missing job id" };
  const nextOfficer = officerId === "" ? null : officerId;

  // Only flip the OPEN/ASSIGNED status when the job is still pre-start —
  // never overwrite IN_PROGRESS / SUBMITTED / REVIEW_PENDING / closed.
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  const isPreStart = job.status === "OPEN" || job.status === "ASSIGNED";
  await prisma.job.update({
    where: { id: jobId },
    data: {
      assignedToUserId: nextOfficer,
      ...(isPreStart && {
        status: nextOfficer ? ("ASSIGNED" as any) : ("OPEN" as any),
      }),
    },
  });
  // Ping the new assignee on Telegram if they've linked it (no-op otherwise).
  if (nextOfficer) {
    notifyAssignedOfficerOfJob(jobId).catch((e) =>
      console.error("notifyAssignedOfficerOfJob failed", e),
    );
  }
  revalidatePath("/patrols");
  revalidatePath("/dispatch");
  revalidatePath("/activities");
  return { ok: true };
}

/**
 * Admin edit for a PatrolVisit. Mirrors the admin Job edit — admins
 * sometimes need to correct attendance times after the fact (officer
 * forgot to check out, status stuck on MISSED when actually attended,
 * etc.). To this business "every activity is a job", so visits get the
 * same edit affordance everywhere a job does.
 */
const VisitStatuses = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "LATE",
  "MISSED",
] as const;

const EditVisitInput = z
  .object({
    officerId: z.string().uuid().or(z.literal("")).optional().nullable(),
    handledByPartnerId: z.string().uuid().or(z.literal("")).optional().nullable(),
    partnerFillsOwnApp: z.boolean().optional().default(false),
    scheduledAt: z.string().min(1, "Scheduled time is required"),
    arrivedAt: z.string().optional().nullable(),
    departedAt: z.string().optional().nullable(),
    status: z.enum(VisitStatuses),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    const arr = parseUkDateTimeLocal(d.arrivedAt);
    const dep = parseUkDateTimeLocal(d.departedAt);
    if (arr && dep && !Number.isNaN(arr.getTime()) && !Number.isNaN(dep.getTime()) && dep <= arr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departedAt"],
        message: "Departure must be after arrival.",
      });
    }
  });

export type EditVisitState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function updatePatrolVisit(
  visitId: string,
  _prev: EditVisitState,
  formData: FormData,
): Promise<EditVisitState> {
  // Dispatcher + admin. EditVisitForm exposes scheduling / officer /
  // notes, no finance fields. Aligns with the dispatch job edit.
  await requireStaff();
  const parsed = EditVisitInput.safeParse({
    officerId: formData.get("officerId")?.toString() || null,
    handledByPartnerId: formData.get("handledByPartnerId")?.toString() || null,
    partnerFillsOwnApp: formData.get("partnerFillsOwnApp") === "on",
    scheduledAt: formData.get("scheduledAt")?.toString() ?? "",
    arrivedAt: formData.get("arrivedAt")?.toString() || null,
    departedAt: formData.get("departedAt")?.toString() || null,
    status: formData.get("status")?.toString() ?? "PENDING",
    notes: formData.get("notes")?.toString() || null,
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  const existing = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    select: { id: true, siteId: true },
  });
  if (!existing) return { error: "Visit not found." };

  // Officer and partner are mutually exclusive. A partner-handled visit
  // carries no internal officer; the flag records whether the partner uses
  // their own app or fills in ours.
  const partnerId =
    d.handledByPartnerId && d.handledByPartnerId !== ""
      ? d.handledByPartnerId
      : null;
  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: {
      officerId: partnerId ? null : d.officerId || null,
      handledByPartnerId: partnerId,
      reportedViaPartnerApp: partnerId ? d.partnerFillsOwnApp : false,
      scheduledAt: parseUkDateTimeLocal(d.scheduledAt) ?? new Date(d.scheduledAt),
      arrivedAt: parseUkDateTimeLocal(d.arrivedAt),
      departedAt: parseUkDateTimeLocal(d.departedAt),
      status: d.status as any,
      notes: d.notes ?? null,
    },
  });

  revalidatePath("/patrols");
  revalidatePath(`/patrols/visits/${visitId}`);
  revalidatePath("/activities");
  if (existing.siteId) revalidatePath(`/sites/${existing.siteId}`);
  redirect(`/patrols/visits/${visitId}`);
}

/**
 * Dispatcher-side "close" for a PatrolVisit. Mirrors closeJob's intent —
 * officer didn't tick the visit complete in the app but told dispatch by
 * radio/phone. Flips status to COMPLETED, stamps arrivedAt + departedAt
 * with the given time (or now), and snapshots billing + officer pay so
 * the visit shows up in finance the same way an officer-completed visit
 * would. Idempotent: re-running on an already-completed visit is a no-op.
 */
export async function closePatrolVisit(
  visitId: string,
  opts?: { closedAt?: Date | null; notes?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      status: true,
      siteId: true,
      officerId: true,
      scheduleDate: true,
      scheduledAt: true,
      arrivedAt: true,
      departedAt: true,
      notes: true,
      billedAmount: true,
      paidAmount: true,
      patrolSchedule: { select: { kind: true } },
    },
  });
  if (!visit) return { ok: false, error: "Visit not found." };
  if (visit.status === "COMPLETED") {
    return { ok: true };
  }

  const closedAt = opts?.closedAt ?? new Date();
  const arrived = visit.arrivedAt ?? closedAt;
  const departed = visit.departedAt ?? closedAt;
  const closerName = me.name || me.email || me.id;
  const extraNote = `Closed by dispatch (${closerName}) on behalf of officer at ${closedAt.toISOString()}${opts?.notes ? ` — ${opts.notes}` : ""}`;
  const mergedNotes = visit.notes ? `${visit.notes}\n${extraNote}` : extraNote;

  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: {
      status: "COMPLETED" as any,
      arrivedAt: arrived,
      departedAt: departed,
      notes: mergedNotes,
    },
  });

  // Snapshot billing + officer pay — mirror the /api/submissions path so
  // finance treats this the same as an officer-completed visit. Accounting
  // date = the scheduled night, so overnight patrols count in the right month.
  if (visit.siteId && visit.billedAmount == null) {
    const at = visit.scheduleDate ?? visit.scheduledAt;
    const rateService = jobTypeToRateService(
      visit.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL",
    );
    if (rateService) {
      const dur = durationMinutes(arrived, departed);
      const bill = await billForSite(visit.siteId, rateService, dur);
      await applyBillingToVisit(visitId, bill, at);
      if (visit.officerId && visit.paidAmount == null) {
        const pay = await payForOfficer(visit.officerId, rateService, dur);
        await applyPayToVisit(visitId, pay, at);
      }
    }
  }

  revalidatePath("/dispatch");
  revalidatePath("/patrols");
  revalidatePath(`/patrols/visits/${visitId}`);
  revalidatePath("/activities");
  revalidatePath("/finance");
  if (visit.siteId) revalidatePath(`/sites/${visit.siteId}`);
  return { ok: true };
}

/**
 * Cancel a patrol/VPI visit (e.g. the client stood the patrol down, or a
 * one-off shouldn't happen). Mirrors cancelJob: keeps the record marked
 * CANCELLED for audit, reverses any billing + officer pay, and stamps who/
 * when. Because the materialiser de-dupes on the exact scheduledAt, a
 * cancelled visit won't be re-created by the nightly sync.
 */
export async function cancelPatrolVisit(
  visitId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    select: { id: true, status: true, siteId: true },
  });
  if (!visit) return { ok: false, error: "Visit not found." };
  if (visit.status === "CANCELLED") return { ok: true };

  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: {
      status: "CANCELLED" as any,
      cancelledAt: new Date(),
      cancelledByUserId: me.id,
      statusBeforeCancel: visit.status as any,
      billedAmount: null,
      billedCurrency: null,
      billedAt: null,
      paidAmount: null,
      paidCurrency: null,
      paidAt: null,
    },
  });

  revalidatePath("/dispatch");
  revalidatePath("/patrols");
  revalidatePath(`/patrols/visits/${visitId}`);
  revalidatePath("/activities");
  revalidatePath("/finance");
  if (visit.siteId) revalidatePath(`/sites/${visit.siteId}`);
  return { ok: true };
}

/**
 * Restore a cancelled visit to its pre-cancel status. Admin only (mirrors
 * restoreJob). Re-snapshots billing + pay only when it comes back as a
 * completed visit — a restored PENDING visit will bill when it's actually
 * completed, exactly like a fresh one.
 */
export async function restorePatrolVisit(
  visitId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      status: true,
      statusBeforeCancel: true,
      siteId: true,
      officerId: true,
      scheduleDate: true,
      scheduledAt: true,
      arrivedAt: true,
      departedAt: true,
      patrolSchedule: { select: { kind: true } },
    },
  });
  if (!visit) return { ok: false, error: "Visit not found." };
  if (visit.status !== "CANCELLED") {
    return { ok: false, error: "Visit isn't cancelled." };
  }
  const next = visit.statusBeforeCancel ?? ("PENDING" as any);

  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: {
      status: next,
      cancelledAt: null,
      cancelledByUserId: null,
      statusBeforeCancel: null,
    },
  });

  if (next === "COMPLETED" && visit.siteId) {
    const at = visit.scheduleDate ?? visit.scheduledAt;
    const rateService = jobTypeToRateService(
      visit.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL",
    );
    if (rateService) {
      const dur = durationMinutes(visit.arrivedAt, visit.departedAt);
      const bill = await billForSite(visit.siteId, rateService, dur);
      await applyBillingToVisit(visitId, bill, at);
      if (visit.officerId) {
        const pay = await payForOfficer(visit.officerId, rateService, dur);
        await applyPayToVisit(visitId, pay, at);
      }
    }
  }

  revalidatePath("/dispatch");
  revalidatePath("/patrols");
  revalidatePath(`/patrols/visits/${visitId}`);
  revalidatePath("/activities");
  revalidatePath("/finance");
  if (visit.siteId) revalidatePath(`/sites/${visit.siteId}`);
  return { ok: true };
}
