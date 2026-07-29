"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  applyPayToJob,
  billForSite,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";
import { notifyAlarmReceived } from "@/lib/notifications";
import {
  alertAlarmReceivedTelegram,
  notifyAssignedOfficerOfJob,
} from "@/lib/telegramNotify";
import { cancelJobCore, closeJobCore } from "@/lib/jobActions";
import { parseUkDateTimeLocal } from "@/lib/dates";
import {
  materializeLockUnlockJobs,
  materializePatrolVisits,
} from "@/lib/scheduleSync";

const JOB_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "VPI",
  "ADHOC",
] as const;

const JOB_SOURCES = [
  "SCHEDULED",
  "ALARM",
  "PARTNER_REQUEST",
  "CUSTOMER_REQUEST",
  "ONBOARDING",
  "AD_HOC",
] as const;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const ALARM_SOURCES = [
  "ARC_EMAIL",
  "ARC_PHONE",
  "PARTNER_EMAIL",
  "PARTNER_PHONE",
  "CUSTOMER_PHONE",
  "MANUAL",
  "WEBHOOK",
] as const;

const HANDLER_KINDS = ["officer", "partner"] as const;

const NewJobInput = z
  .object({
    siteId: z.string().uuid("Pick a site"),
    type: z.enum(JOB_TYPES),
    typeLabel: z.string().trim().max(120).optional().nullable(),
    source: z.enum(JOB_SOURCES),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    scheduledFor: z.string().optional().nullable(),
    handlerKind: z.enum(HANDLER_KINDS).default("officer"),
    assignedToUserId: z.string().uuid().or(z.literal("")).optional().nullable(),
    handlerPartnerId: z.string().uuid().or(z.literal("")).optional().nullable(),
    handedOffAt: z.string().optional().nullable(),
    partnerOfficerName: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    reportedViaPartnerApp: z.boolean().default(false),
    partnerReportRef: z.string().trim().max(200).optional().nullable(),
    // alarm-specific (only used when type === ALARM_RESPONSE)
    alarmSource: z.enum(ALARM_SOURCES).optional().nullable(),
    alarmZone: z.string().trim().max(120).optional().nullable(),
    alarmRawSubject: z.string().trim().max(500).optional().nullable(),
    alarmRawBody: z.string().trim().max(5000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.type === "ALARM_RESPONSE" && !d.alarmSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alarmSource"],
        message: "Alarm source is required for alarm response jobs",
      });
    }
    if (d.handlerKind === "partner" && (!d.handlerPartnerId || d.handlerPartnerId === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handlerPartnerId"],
        message: "Pick the partner you're giving it to.",
      });
    }
  });

export type NewJobState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseForm(formData: FormData) {
  const raw = {
    siteId: formData.get("siteId")?.toString() ?? "",
    type: formData.get("type")?.toString() ?? "ADHOC",
    typeLabel: formData.get("typeLabel")?.toString() || null,
    source: formData.get("source")?.toString() ?? "CUSTOMER_REQUEST",
    priority: formData.get("priority")?.toString() ?? "MEDIUM",
    scheduledFor: formData.get("scheduledFor")?.toString() || null,
    handlerKind: formData.get("handlerKind")?.toString() ?? "officer",
    assignedToUserId: formData.get("assignedToUserId")?.toString() || null,
    handlerPartnerId: formData.get("handlerPartnerId")?.toString() || null,
    handedOffAt: formData.get("handedOffAt")?.toString() || null,
    partnerOfficerName: formData.get("partnerOfficerName")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
    reportedViaPartnerApp: formData.get("reportedViaPartnerApp") === "on",
    partnerReportRef: formData.get("partnerReportRef")?.toString() || null,
    alarmSource: formData.get("alarmSource")?.toString() || null,
    alarmZone: formData.get("alarmZone")?.toString() || null,
    alarmRawSubject: formData.get("alarmRawSubject")?.toString() || null,
    alarmRawBody: formData.get("alarmRawBody")?.toString() || null,
  };
  return NewJobInput.safeParse(raw);
}

export async function createJob(
  _prev: NewJobState,
  formData: FormData,
): Promise<NewJobState> {
  const me = await requireStaff();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

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

  const handlerPartnerId =
    d.handlerKind === "partner" ? d.handlerPartnerId || null : null;
  const assignedToUserId =
    d.handlerKind === "officer" ? d.assignedToUserId || null : null;

  if (handlerPartnerId) {
    const partner = await prisma.partner.findUnique({
      where: { id: handlerPartnerId },
      select: { active: true, role: true },
    });
    if (!partner || !partner.active) {
      return {
        error: "Partner not found or inactive.",
        fieldErrors: { handlerPartnerId: ["Unknown or inactive"] },
      };
    }
    if (partner.role !== "SUBCONTRACTOR" && partner.role !== "BOTH") {
      return {
        error: "Only subcontracting partners (Nexus, Keyholding Co) can take a sub'd job.",
        fieldErrors: { handlerPartnerId: ["Not a subcontracting partner"] },
      };
    }
  }

  // For alarm responses, write the AlarmEvent first and link it on the job.
  let alarmEventId: string | null = null;
  if (d.type === "ALARM_RESPONSE") {
    const alarm = await prisma.alarmEvent.create({
      data: {
        siteId: d.siteId,
        source: d.alarmSource as any,
        zone: d.alarmZone,
        priority: d.priority as any,
        rawSubject: d.alarmRawSubject,
        rawBody: d.alarmRawBody,
        assignedToId: assignedToUserId,
      },
      select: { id: true },
    });
    alarmEventId = alarm.id;
  }

  // Status: ASSIGNED if we've already designated who handles it
  // (internal officer OR a partner). OPEN otherwise.
  const status =
    assignedToUserId || handlerPartnerId
      ? ("ASSIGNED" as any)
      : ("OPEN" as any);

  const created = await prisma.job.create({
    data: {
      type: d.type as any,
      typeLabel: d.typeLabel ?? null,
      source: d.source as any,
      status,
      priority: d.priority as any,
      siteId: d.siteId,
      customerId: site.customerId,
      partnerId: site.partnerId,
      responderType:
        d.handlerKind === "partner" ? ("PARTNER" as any) : ("INTERNAL_OFFICER" as any),
      assignedToUserId,
      handledByPartnerId: handlerPartnerId,
      handedOffAt: parseUkDateTimeLocal(d.handedOffAt),
      externalResponder:
        d.handlerKind === "partner" ? d.partnerOfficerName ?? null : null,
      alarmEventId,
      scheduledFor: parseUkDateTimeLocal(d.scheduledFor),
      reportedViaPartnerApp: d.reportedViaPartnerApp,
      partnerReportRef: d.partnerReportRef,
      notes: d.notes,
    },
    select: { id: true },
  });

  // Best-effort billing snapshot. Officer pay only when WE attended —
  // sub'd-to-partner jobs leave the pay slot empty (what we owe the
  // partner is tracked separately).
  const rateService = jobTypeToRateService(d.type);
  if (rateService) {
    // Accounting date = the scheduled date (falls back to "now" in apply*
    // when it's an ad-hoc job with no schedule).
    const at = parseUkDateTimeLocal(d.scheduledFor);
    const bill = await billForSite(d.siteId, rateService);
    if (bill.ok) await applyBillingToJob(created.id, bill, at);
    if (assignedToUserId) {
      const pay = await payForOfficer(assignedToUserId, rateService);
      if (pay.ok) await applyPayToJob(created.id, pay, at);
    }
  }

  if (alarmEventId) {
    notifyAlarmReceived(alarmEventId).catch((e) =>
      console.error("notifyAlarmReceived failed", e),
    );
    // Heads-up to all linked dispatch/admin on Telegram.
    alertAlarmReceivedTelegram(alarmEventId).catch((e) =>
      console.error("alertAlarmReceivedTelegram failed", e),
    );
  }

  // Ping the assignee on Telegram if they've linked it (no-op otherwise).
  if (assignedToUserId) {
    notifyAssignedOfficerOfJob(created.id).catch((e) =>
      console.error("notifyAssignedOfficerOfJob failed", e),
    );
  }

  revalidatePath("/dispatch");
  revalidatePath(`/sites/${d.siteId}`);
  redirect("/dispatch");
}

/**
 * Dispatcher-side "close" — for activities the officer didn't close in
 * the app but informed dispatch about by phone/radio. Marks the Job as
 * APPROVED (the same terminal state used by recordDispatcherCallout and
 * the auto-approve flow), stamps startedAt + completedAt with the given
 * time (or now), and triggers the billing + officer-pay snapshot so
 * finance reflects it. No /submit form is created — the audit trail is
 * the JobAudit-equivalent fields (recordedByUserId-style) plus the
 * notes. Dispatcher + admin can use this; restore stays admin-only.
 */
export async function closeJob(
  jobId: string,
  opts?: { closedAt?: Date | null; notes?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const closedAt = opts?.closedAt ?? new Date();
  // Note appended so the audit trail captures "closed by dispatcher
  // because officer informed by phone" without a separate column.
  const closerName = me.name || me.email || me.id;
  const note = `Closed by dispatch (${closerName}) on behalf of officer at ${closedAt.toISOString()}${opts?.notes ? ` — ${opts.notes}` : ""}`;

  const r = await closeJobCore(jobId, { closedAt, note });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/dispatch");
  revalidatePath(`/dispatch/${jobId}`);
  revalidatePath("/activities");
  revalidatePath("/finance");
  if (r.siteId) revalidatePath(`/sites/${r.siteId}`);
  return { ok: true };
}

/**
 * Cancel a job — removes it from /dispatch's live view by flipping the
 * status to CANCELLED. Records who cancelled and when for audit. We don't
 * hard-delete because FormSubmission.jobId is now ON DELETE SetNull but
 * we still want a record that this job existed and was deliberately
 * cancelled (not just lost).
 */
export async function cancelJob(
  jobId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const r = await cancelJobCore(jobId, me.id);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/dispatch");
  revalidatePath("/patrols");
  revalidatePath("/activities");
  revalidatePath("/finance");
  if (r.siteId) revalidatePath(`/sites/${r.siteId}`);
  return { ok: true };
}

/**
 * Restore a cancelled Job back to its pre-cancel status and re-snapshot
 * the billing + pay so finance reflects it again. Available to admin
 * only — Dispatcher can cancel but only Admin can restore (assume any
 * cancel they did was deliberate).
 */
export async function restoreJob(
  jobId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      statusBeforeCancel: true,
      siteId: true,
      assignedToUserId: true,
      type: true,
      scheduledFor: true,
      completedAt: true,
    },
  });
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status !== "CANCELLED") {
    return { ok: false, error: "Job isn't cancelled." };
  }
  // statusBeforeCancel is only stamped by the new cancelJob. Older
  // cancellations don't have one — restore them to OPEN/ASSIGNED based
  // on whether they had an officer (mirrors createJob's status pick).
  const next =
    job.statusBeforeCancel ??
    (job.assignedToUserId ? "ASSIGNED" : "OPEN");

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: next as any,
      cancelledAt: null,
      cancelledByUserId: null,
      statusBeforeCancel: null,
    },
  });

  // Re-snapshot the billing + pay from live rates. Same logic as
  // createJob's tail. Officer pay only when the job is internally
  // attended; partner-handled stays unpaid. Accounting date = scheduled
  // date, else completion.
  if (job.siteId) {
    const at = job.scheduledFor ?? job.completedAt ?? null;
    const rateService = jobTypeToRateService(job.type);
    if (rateService) {
      const bill = await billForSite(job.siteId, rateService);
      if (bill.ok) await applyBillingToJob(jobId, bill, at);
      if (job.assignedToUserId) {
        const pay = await payForOfficer(job.assignedToUserId, rateService);
        if (pay.ok) await applyPayToJob(jobId, pay, at);
      }
    }
  }

  revalidatePath("/dispatch");
  revalidatePath("/patrols");
  revalidatePath("/activities");
  revalidatePath("/finance");
  if (job.siteId) revalidatePath(`/sites/${job.siteId}`);
  return { ok: true };
}

/**
 * Admin job editor. Lets an admin correct any field on a Job after the
 * fact — the original creator (cron, dispatcher form) may have got
 * something wrong, or the operator may have learned more later (e.g.
 * partner finally sent their report). Audit trail: just the Job's
 * own updatedAt; we don't snapshot field-level diffs yet.
 *
 * Scope: editable fields are content (type, source, priority, times,
 * notes, handover details, the rates-relevant identifiers). Status
 * isn't free-text editable — that still flows through the cancel
 * button + review queue + completion flow so the state machine stays
 * honest. Cancelled jobs aren't editable (use the cancel button +
 * un-cancel separately if needed).
 */
const EditJobInput = z
  .object({
    type: z.enum(JOB_TYPES),
    typeLabel: z.string().trim().max(120).optional().nullable(),
    source: z.enum(JOB_SOURCES),
    priority: z.enum(PRIORITIES),
    scheduledFor: z.string().optional().nullable(),
    handlerKind: z.enum(HANDLER_KINDS).default("officer"),
    assignedToUserId: z.string().uuid().or(z.literal("")).optional().nullable(),
    handlerPartnerId: z.string().uuid().or(z.literal("")).optional().nullable(),
    handedOffAt: z.string().optional().nullable(),
    partnerOfficerName: z.string().trim().max(120).optional().nullable(),
    startedAt: z.string().optional().nullable(),
    completedAt: z.string().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    excludeFromClientReport: z.boolean().default(false),
    partnerReportRef: z.string().trim().max(200).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.handlerKind === "partner" && (!d.handlerPartnerId || d.handlerPartnerId === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handlerPartnerId"],
        message: "Pick the partner.",
      });
    }
    const start = parseUkDateTimeLocal(d.startedAt);
    const end = parseUkDateTimeLocal(d.completedAt);
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "End must be after start.",
      });
    }
  });

export type EditJobState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseEditForm(formData: FormData) {
  return EditJobInput.safeParse({
    type: formData.get("type")?.toString() ?? "",
    typeLabel: formData.get("typeLabel")?.toString() || null,
    source: formData.get("source")?.toString() ?? "",
    priority: formData.get("priority")?.toString() ?? "MEDIUM",
    scheduledFor: formData.get("scheduledFor")?.toString() || null,
    handlerKind: formData.get("handlerKind")?.toString() ?? "officer",
    assignedToUserId: formData.get("assignedToUserId")?.toString() || null,
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

export async function updateJob(
  jobId: string,
  _prev: EditJobState,
  formData: FormData,
): Promise<EditJobState> {
  // Dispatcher + admin. The edit form doesn't expose finance fields
  // (billed/paid live on the model but not in the form), so opening
  // this up to dispatcher doesn't leak money. Restore stays admin-only.
  await requireStaff();
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, siteId: true, alarmEventId: true },
  });
  if (!existing) return { error: "Job not found." };
  if (existing.status === "CANCELLED") {
    return {
      error: "Cancelled jobs aren't editable. Restore via the cancel button first.",
    };
  }

  const parsed = parseEditForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  const handlerPartnerId =
    d.handlerKind === "partner" ? d.handlerPartnerId || null : null;
  const assignedToUserId =
    d.handlerKind === "officer" ? d.assignedToUserId || null : null;

  if (handlerPartnerId) {
    const partner = await prisma.partner.findUnique({
      where: { id: handlerPartnerId },
      select: { active: true, role: true },
    });
    if (!partner || !partner.active) {
      return {
        error: "Partner not found or inactive.",
        fieldErrors: { handlerPartnerId: ["Unknown or inactive"] },
      };
    }
    if (partner.role !== "SUBCONTRACTOR" && partner.role !== "BOTH") {
      return {
        error: "Only subcontracting partners can take a sub'd job.",
        fieldErrors: { handlerPartnerId: ["Not a subcontracting partner"] },
      };
    }
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      type: d.type as any,
      typeLabel: d.typeLabel ?? null,
      source: d.source as any,
      priority: d.priority as any,
      scheduledFor: parseUkDateTimeLocal(d.scheduledFor),
      responderType:
        d.handlerKind === "partner" ? ("PARTNER" as any) : ("INTERNAL_OFFICER" as any),
      assignedToUserId,
      handledByPartnerId: handlerPartnerId,
      handedOffAt: parseUkDateTimeLocal(d.handedOffAt),
      externalResponder:
        d.handlerKind === "partner" ? d.partnerOfficerName ?? null : null,
      startedAt: parseUkDateTimeLocal(d.startedAt),
      completedAt: parseUkDateTimeLocal(d.completedAt),
      notes: d.notes ?? null,
      excludeFromClientReport: d.excludeFromClientReport,
      partnerReportRef: d.partnerReportRef ?? null,
    },
  });

  revalidatePath("/dispatch");
  revalidatePath(`/dispatch/${jobId}`);
  revalidatePath("/activities");
  if (existing.siteId) revalidatePath(`/sites/${existing.siteId}`);
  redirect(`/dispatch/${jobId}`);
}

/**
 * Manual trigger for the recurring-schedule materialiser. Backs the
 * "Sync schedules" button on /dispatch. Same code path as the daily
 * Vercel cron, just kicked off by a human — useful when a schedule was
 * added late in the day or the cron run was missed.
 *
 * Idempotent: re-running for an already-materialised day is a no-op
 * (the materialiser checks for an existing Job / PatrolVisit on the
 * same site + day).
 */
export type SyncDiagnosticRow = {
  date: string;
  scheduleId: string;
  siteName: string;
  kind: string;
  dayOfWeek: string;
  status: "created" | "exists" | "skipped";
  reason?: string;
};

export type SyncSchedulesResult = {
  ok: true;
  jobsCreated: number;
  visitsCreated: number;
  daysCovered: string[];
  patrolDiagnostics: SyncDiagnosticRow[];
};

export async function syncSchedulesNow(): Promise<SyncSchedulesResult> {
  await requireStaff();
  const anchor = new Date();
  const [lockUnlock, patrol] = await Promise.all([
    materializeLockUnlockJobs({ anchor, offsets: [0, 1] }),
    materializePatrolVisits({ anchor, offsets: [0, 1] }),
  ]);
  const jobsCreated = lockUnlock.reduce(
    (sum, d) => sum + d.createdLock + d.createdUnlock,
    0,
  );
  const visitsCreated = patrol.reduce((sum, d) => sum + d.created, 0);
  const daysCovered = Array.from(
    new Set([...lockUnlock.map((d) => d.date), ...patrol.map((d) => d.date)]),
  ).sort();
  const patrolDiagnostics: SyncDiagnosticRow[] = patrol.flatMap((day) =>
    day.diagnostics.map((d) => ({ ...d, date: day.date })),
  );
  revalidatePath("/dispatch");
  revalidatePath("/patrols");
  return {
    ok: true,
    jobsCreated,
    visitsCreated,
    daysCovered,
    patrolDiagnostics,
  };
}
