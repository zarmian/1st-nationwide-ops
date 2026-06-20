"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { parseUkDateTimeLocal } from "@/lib/dates";

/**
 * Partner-recorded activity CRUD.
 *
 * Phase 2: partners create Jobs and Shifts inline. Every row gets:
 *   - handledByPartnerId        = session partnerId
 *   - handledByPartnerOfficerId = the picked PartnerOfficer
 *   - partnerChargeToUsAmount   = what they charge us
 *   - partnerOfficerPayAmount   = what they pay their officer
 *   - recordedByPartner         = true  (lets us scope edit/cancel and
 *                                        distinguish from jobs we sent)
 *
 * Status policy: partner-recorded rows land in a terminal state by
 * default (Job=APPROVED, Shift=COMPLETED). The user said they're
 * recording work that's *already been done*; no scheduled/pending flow.
 *
 * Edit + cancel are only allowed on rows the partner recorded
 * themselves (recordedByPartner = true). Jobs we sent stay read-only.
 */

export type ActivityFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

// Same job-type vocabulary the staff-side callout form uses, minus the
// service-only entries (ANNUAL_SUBSCRIPTION / SITE_SETUP). KEY_*/SURVEY
// are kept so partners can log key collections etc. they did for us.
const JobTypes = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "SURVEY",
  "ADHOC",
] as const;

const ShiftTypes = ["STATIC_GUARDING", "DOG_HANDLER"] as const;

// Map JobType → RateService so we can look up the partner's rate card
// at create-time and pre-fill chargeToUs / payToOfficer. The partner
// can still override on the form.
const JOB_TYPE_TO_RATE: Record<string, string> = {
  ALARM_RESPONSE: "ALARM_RESPONSE",
  PATROL: "PATROL",
  LOCK: "LOCKUP",
  UNLOCK: "UNLOCK",
  VPI: "VPI",
  KEY_COLLECTION: "KEYHOLDING",
  KEY_DROPOFF: "KEYHOLDING",
  SURVEY: "ADHOC",
  ADHOC: "ADHOC",
};
const SHIFT_TYPE_TO_RATE: Record<string, string> = {
  STATIC_GUARDING: "STATIC_GUARDING",
  DOG_HANDLER: "DOG_HANDLER",
};

const Common = z.object({
  customerId: z.string().uuid("Pick a customer"),
  siteId: z.string().uuid("Pick a site"),
  partnerOfficerId: z.string().uuid("Pick an officer").or(z.literal("")).nullable().transform((v) => v || null),
  chargeToUs: z.coerce.number().min(0).max(99_999_999).default(0),
  payToOfficer: z.coerce.number().min(0).max(99_999_999).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const JobInput = Common.extend({
  kind: z.literal("JOB"),
  type: z.enum(JobTypes),
  scheduledFor: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
});

// SHIFT carries an extra `shiftMode` sub-discriminator:
//   "completed" → actual start/end (today's behaviour, default)
//   "scheduled" → future start/end + check-in interval / grace, status
//                  lands at PENDING so the officer can clock in later.
const ShiftCompletedInput = Common.extend({
  kind: z.literal("SHIFT"),
  shiftMode: z.literal("completed").default("completed"),
  type: z.enum(ShiftTypes),
  startedAt: z.string().min(1, "Start time required"),
  endedAt: z.string().min(1, "End time required"),
});

const ShiftScheduledInput = Common.extend({
  kind: z.literal("SHIFT"),
  shiftMode: z.literal("scheduled"),
  type: z.enum(ShiftTypes),
  scheduledStartsAt: z.string().min(1, "Start time required"),
  scheduledEndsAt: z.string().min(1, "End time required"),
  checkIntervalMin: z.coerce.number().int().min(5).max(720).default(60),
  graceMinutes: z.coerce.number().int().min(0).max(120).default(15),
});

const Input = z.union([JobInput, ShiftCompletedInput, ShiftScheduledInput]);

function parseForm(formData: FormData) {
  const kind = formData.get("kind")?.toString();
  if (kind === "JOB") {
    return Input.safeParse({
      kind: "JOB",
      customerId: formData.get("customerId")?.toString() ?? "",
      siteId: formData.get("siteId")?.toString() ?? "",
      partnerOfficerId: formData.get("partnerOfficerId")?.toString() ?? "",
      chargeToUs: formData.get("chargeToUs")?.toString() ?? "0",
      payToOfficer: formData.get("payToOfficer")?.toString() ?? "0",
      notes: formData.get("notes")?.toString() || null,
      type: formData.get("type")?.toString() ?? "ALARM_RESPONSE",
      scheduledFor: formData.get("scheduledFor")?.toString() || null,
      completedAt: formData.get("completedAt")?.toString() || null,
    });
  }
  // SHIFT branch — switch on shiftMode.
  const shiftMode = formData.get("shiftMode")?.toString() ?? "completed";
  if (shiftMode === "scheduled") {
    return Input.safeParse({
      kind: "SHIFT",
      shiftMode: "scheduled",
      customerId: formData.get("customerId")?.toString() ?? "",
      siteId: formData.get("siteId")?.toString() ?? "",
      partnerOfficerId: formData.get("partnerOfficerId")?.toString() ?? "",
      chargeToUs: formData.get("chargeToUs")?.toString() ?? "0",
      payToOfficer: formData.get("payToOfficer")?.toString() ?? "0",
      notes: formData.get("notes")?.toString() || null,
      type: formData.get("type")?.toString() ?? "STATIC_GUARDING",
      scheduledStartsAt: formData.get("scheduledStartsAt")?.toString() ?? "",
      scheduledEndsAt: formData.get("scheduledEndsAt")?.toString() ?? "",
      checkIntervalMin: formData.get("checkIntervalMin")?.toString() ?? "60",
      graceMinutes: formData.get("graceMinutes")?.toString() ?? "15",
    });
  }
  return Input.safeParse({
    kind: "SHIFT",
    shiftMode: "completed",
    customerId: formData.get("customerId")?.toString() ?? "",
    siteId: formData.get("siteId")?.toString() ?? "",
    partnerOfficerId: formData.get("partnerOfficerId")?.toString() ?? "",
    chargeToUs: formData.get("chargeToUs")?.toString() ?? "0",
    payToOfficer: formData.get("payToOfficer")?.toString() ?? "0",
    notes: formData.get("notes")?.toString() || null,
    type: formData.get("type")?.toString() ?? "STATIC_GUARDING",
    startedAt: formData.get("startedAt")?.toString() ?? "",
    endedAt: formData.get("endedAt")?.toString() ?? "",
  });
}

async function verifySiteBelongsToCustomer(
  siteId: string,
  customerId: string,
): Promise<boolean> {
  const site = await prisma.site.findFirst({
    where: { id: siteId, customerId, active: true },
    select: { id: true },
  });
  return !!site;
}

async function verifyOfficerBelongsToPartner(
  officerId: string,
  partnerId: string,
): Promise<boolean> {
  const o = await prisma.partnerOfficer.findFirst({
    where: { id: officerId, partnerId, active: true },
    select: { id: true },
  });
  return !!o;
}

export async function createPartnerActivity(
  _prev: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const me = await requirePartner();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  // Q4 = a: customer + site required, and the site must belong to that
  // customer. Cross-checks happen here so the partner can't smuggle in
  // an arbitrary siteId.
  if (!(await verifySiteBelongsToCustomer(d.siteId, d.customerId))) {
    return {
      error: "Site doesn't belong to the chosen customer.",
      fieldErrors: { siteId: ["Pick a site under this customer"] },
    };
  }
  if (
    d.partnerOfficerId &&
    !(await verifyOfficerBelongsToPartner(d.partnerOfficerId, me.partnerId))
  ) {
    return {
      error: "Officer isn't on your roster.",
      fieldErrors: { partnerOfficerId: ["Pick one of your officers"] },
    };
  }

  if (d.kind === "JOB") {
    const scheduledFor =
      parseUkDateTimeLocal(d.scheduledFor) ?? null;
    const completedAt =
      parseUkDateTimeLocal(d.completedAt) ?? new Date();
    const created = await prisma.job.create({
      data: {
        type: d.type as any,
        source: "PARTNER_REQUEST" as any,
        status: "APPROVED" as any,
        siteId: d.siteId,
        customerId: d.customerId,
        partnerId: null,
        responderType: "PARTNER" as any,
        handledByPartnerId: me.partnerId,
        handledByPartnerOfficerId: d.partnerOfficerId,
        partnerChargeToUsAmount: d.chargeToUs || 0,
        partnerOfficerPayAmount: d.payToOfficer || 0,
        recordedByPartner: true,
        scheduledFor,
        startedAt: scheduledFor ?? completedAt,
        completedAt,
        notes: d.notes,
      },
      select: { id: true },
    });
    revalidatePath("/partner/activities");
    revalidatePath("/partner/finance");
    redirect(`/partner/activities/${created.id}/edit`);
  } else if (d.shiftMode === "scheduled") {
    // Future shift — same shape as the staff /shifts/new flow:
    // scheduled times + check-in interval + grace. Lands at PENDING.
    const start = parseUkDateTimeLocal(d.scheduledStartsAt);
    const end = parseUkDateTimeLocal(d.scheduledEndsAt);
    if (!start || !end) {
      return {
        error: "Couldn't read the start / end time.",
        fieldErrors: !start
          ? { scheduledStartsAt: ["Invalid date"] }
          : { scheduledEndsAt: ["Invalid date"] },
      };
    }
    if (end <= start) {
      return {
        error: "End must be after start.",
        fieldErrors: { scheduledEndsAt: ["After start"] },
      };
    }
    const created = await prisma.shift.create({
      data: {
        siteId: d.siteId,
        officerId: null,
        type: d.type as any,
        scheduledStartsAt: start,
        scheduledEndsAt: end,
        actualStartedAt: null,
        actualEndedAt: null,
        status: "PENDING" as any,
        checkIntervalMin: d.checkIntervalMin,
        graceMinutes: d.graceMinutes,
        handledByPartnerId: me.partnerId,
        handledByPartnerOfficerId: d.partnerOfficerId,
        partnerChargeToUsAmount: d.chargeToUs || 0,
        partnerOfficerPayAmount: d.payToOfficer || 0,
        recordedByPartner: true,
        notes: d.notes,
      },
      select: { id: true },
    });
    revalidatePath("/partner/activities");
    revalidatePath("/partner/finance");
    redirect(`/partner/activities/shift-${created.id}/edit`);
  } else {
    // Already-completed shift (default mode).
    const startedAt = parseUkDateTimeLocal(d.startedAt);
    const endedAt = parseUkDateTimeLocal(d.endedAt);
    if (!startedAt || !endedAt) {
      return {
        error: "Couldn't read the start / end time.",
        fieldErrors: !startedAt
          ? { startedAt: ["Invalid date"] }
          : { endedAt: ["Invalid date"] },
      };
    }
    if (endedAt <= startedAt) {
      return {
        error: "End must be after start.",
        fieldErrors: { endedAt: ["After start"] },
      };
    }
    const created = await prisma.shift.create({
      data: {
        siteId: d.siteId,
        officerId: null,
        type: d.type as any,
        scheduledStartsAt: startedAt,
        scheduledEndsAt: endedAt,
        actualStartedAt: startedAt,
        actualEndedAt: endedAt,
        status: "COMPLETED" as any,
        // Disable check-ins on partner-recorded shifts. They're
        // logged after-the-fact, not run by us in real time.
        checkIntervalMin: 0,
        graceMinutes: 0,
        handledByPartnerId: me.partnerId,
        handledByPartnerOfficerId: d.partnerOfficerId,
        partnerChargeToUsAmount: d.chargeToUs || 0,
        partnerOfficerPayAmount: d.payToOfficer || 0,
        recordedByPartner: true,
        notes: d.notes,
      },
      select: { id: true },
    });
    revalidatePath("/partner/activities");
    revalidatePath("/partner/finance");
    redirect(`/partner/activities/shift-${created.id}/edit`);
  }
}

export async function updatePartnerActivity(
  encodedId: string,
  _prev: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const me = await requirePartner();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  if (!(await verifySiteBelongsToCustomer(d.siteId, d.customerId))) {
    return {
      error: "Site doesn't belong to the chosen customer.",
      fieldErrors: { siteId: ["Pick a site under this customer"] },
    };
  }
  if (
    d.partnerOfficerId &&
    !(await verifyOfficerBelongsToPartner(d.partnerOfficerId, me.partnerId))
  ) {
    return {
      error: "Officer isn't on your roster.",
      fieldErrors: { partnerOfficerId: ["Pick one of your officers"] },
    };
  }

  const isShift = encodedId.startsWith("shift-");
  const rawId = isShift ? encodedId.slice("shift-".length) : encodedId;

  if (!isShift && d.kind === "JOB") {
    const scheduledFor = parseUkDateTimeLocal(d.scheduledFor) ?? null;
    const completedAt = parseUkDateTimeLocal(d.completedAt) ?? new Date();
    const r = await prisma.job.updateMany({
      where: {
        id: rawId,
        handledByPartnerId: me.partnerId,
        recordedByPartner: true,
      },
      data: {
        type: d.type as any,
        siteId: d.siteId,
        customerId: d.customerId,
        handledByPartnerOfficerId: d.partnerOfficerId,
        partnerChargeToUsAmount: d.chargeToUs || 0,
        partnerOfficerPayAmount: d.payToOfficer || 0,
        scheduledFor,
        startedAt: scheduledFor ?? completedAt,
        completedAt,
        notes: d.notes,
      },
    });
    if (r.count === 0) return { error: "Not found or not yours to edit." };
  } else if (isShift && d.kind === "SHIFT") {
    if (d.shiftMode === "scheduled") {
      const start = parseUkDateTimeLocal(d.scheduledStartsAt);
      const end = parseUkDateTimeLocal(d.scheduledEndsAt);
      if (!start || !end) {
        return {
          error: "Couldn't read the start / end time.",
          fieldErrors: !start
            ? { scheduledStartsAt: ["Invalid date"] }
            : { scheduledEndsAt: ["Invalid date"] },
        };
      }
      if (end <= start) {
        return {
          error: "End must be after start.",
          fieldErrors: { scheduledEndsAt: ["After start"] },
        };
      }
      const r = await prisma.shift.updateMany({
        where: {
          id: rawId,
          handledByPartnerId: me.partnerId,
          recordedByPartner: true,
        },
        data: {
          type: d.type as any,
          siteId: d.siteId,
          handledByPartnerOfficerId: d.partnerOfficerId,
          partnerChargeToUsAmount: d.chargeToUs || 0,
          partnerOfficerPayAmount: d.payToOfficer || 0,
          scheduledStartsAt: start,
          scheduledEndsAt: end,
          checkIntervalMin: d.checkIntervalMin,
          graceMinutes: d.graceMinutes,
          notes: d.notes,
        },
      });
      if (r.count === 0) return { error: "Not found or not yours to edit." };
    } else {
      const startedAt = parseUkDateTimeLocal(d.startedAt);
      const endedAt = parseUkDateTimeLocal(d.endedAt);
      if (!startedAt || !endedAt) {
        return {
          error: "Couldn't read the start / end time.",
          fieldErrors: !startedAt
            ? { startedAt: ["Invalid date"] }
            : { endedAt: ["Invalid date"] },
        };
      }
      if (endedAt <= startedAt) {
        return {
          error: "End must be after start.",
          fieldErrors: { endedAt: ["After start"] },
        };
      }
      const r = await prisma.shift.updateMany({
        where: {
          id: rawId,
          handledByPartnerId: me.partnerId,
          recordedByPartner: true,
        },
        data: {
          type: d.type as any,
          siteId: d.siteId,
          handledByPartnerOfficerId: d.partnerOfficerId,
          partnerChargeToUsAmount: d.chargeToUs || 0,
          partnerOfficerPayAmount: d.payToOfficer || 0,
          scheduledStartsAt: startedAt,
          scheduledEndsAt: endedAt,
          actualStartedAt: startedAt,
          actualEndedAt: endedAt,
          notes: d.notes,
        },
      });
      if (r.count === 0) return { error: "Not found or not yours to edit." };
    }
  } else {
    return { error: "Kind doesn't match the record." };
  }

  revalidatePath("/partner/activities");
  revalidatePath(`/partner/activities/${encodedId}/edit`);
  revalidatePath("/partner/finance");
  return { success: "Saved." };
}

export async function cancelPartnerActivity(
  encodedId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requirePartner();
  const isShift = encodedId.startsWith("shift-");
  const rawId = isShift ? encodedId.slice("shift-".length) : encodedId;

  if (isShift) {
    // We don't have a CANCELLED on ShiftStatus today; delete the row
    // instead. Safe — only the partner's own partner-recorded rows.
    const r = await prisma.shift.deleteMany({
      where: {
        id: rawId,
        handledByPartnerId: me.partnerId,
        recordedByPartner: true,
      },
    });
    if (r.count === 0) return { ok: false, error: "Not found." };
  } else {
    const r = await prisma.job.updateMany({
      where: {
        id: rawId,
        handledByPartnerId: me.partnerId,
        recordedByPartner: true,
      },
      data: {
        status: "CANCELLED" as any,
        cancelledAt: new Date(),
      },
    });
    if (r.count === 0) return { ok: false, error: "Not found." };
  }
  revalidatePath("/partner/activities");
  revalidatePath("/partner/finance");
  return { ok: true };
}

/**
 * Server-side rate lookup used by the new-activity form. Given a
 * JobType or ShiftType, returns the partner's rate snapshot (or null
 * if they haven't set one yet). Centralised so the form, the action,
 * and any future autocomplete share the same mapping.
 */
export async function getPartnerRateForType(
  kind: "JOB" | "SHIFT",
  type: string,
): Promise<{ chargeToUs: number; payToOfficer: number; unit: string } | null> {
  const me = await requirePartner();
  const service =
    kind === "JOB" ? JOB_TYPE_TO_RATE[type] : SHIFT_TYPE_TO_RATE[type];
  if (!service) return null;
  const r = await prisma.partnerRate.findUnique({
    where: { partnerId_service: { partnerId: me.partnerId, service: service as any } },
    select: { chargeToUs: true, payToOfficer: true, unit: true },
  });
  if (!r) return null;
  return {
    chargeToUs: Number(r.chargeToUs),
    payToOfficer: Number(r.payToOfficer),
    unit: r.unit,
  };
}

// ── Assign officer to an admin-logged shift ───────────────────────────────
// When 1NW staff use /shifts/completed/new with handlerKind=partner, the
// row lands with handledByPartnerId set but handledByPartnerOfficerId
// null and recordedByPartner=false. This action lets the partner pick
// which of their officers attended + optionally set their billing
// snapshot — so the partner-portal finance dashboard reflects what
// they're charging us / paying their officer for the shift.

const AssignInput = z.object({
  partnerOfficerId: z
    .string()
    .uuid()
    .or(z.literal(""))
    .nullable()
    .transform((v) => v || null),
  chargeToUs: z.coerce.number().min(0).max(99_999_999).default(0),
  payToOfficer: z.coerce.number().min(0).max(99_999_999).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function assignAdminShift(
  shiftId: string,
  _prev: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const me = await requirePartner();
  const parsed = AssignInput.safeParse({
    partnerOfficerId: formData.get("partnerOfficerId")?.toString() ?? "",
    chargeToUs: formData.get("chargeToUs")?.toString() ?? "0",
    payToOfficer: formData.get("payToOfficer")?.toString() ?? "0",
    notes: formData.get("notes")?.toString() || null,
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  if (d.partnerOfficerId) {
    if (!(await verifyOfficerBelongsToPartner(d.partnerOfficerId, me.partnerId))) {
      return {
        error: "Officer isn't on your roster.",
        fieldErrors: { partnerOfficerId: ["Pick one of your officers"] },
      };
    }
  }
  // Scope strictly to admin-logged rows owned by this partner.
  const r = await prisma.shift.updateMany({
    where: {
      id: shiftId,
      handledByPartnerId: me.partnerId,
      recordedByPartner: false,
    },
    data: {
      handledByPartnerOfficerId: d.partnerOfficerId,
      partnerChargeToUsAmount: d.chargeToUs || 0,
      partnerOfficerPayAmount: d.payToOfficer || 0,
      notes: d.notes,
    },
  });
  if (r.count === 0) {
    return { error: "Shift not found." };
  }
  revalidatePath("/partner/activities");
  revalidatePath("/partner/finance");
  return { success: "Saved." };
}

/**
 * Job-side mirror of assignAdminShift. When 1NW staff dispatch a job
 * with handledByPartnerId set (callout sent to partner), the row lands
 * with handledByPartnerOfficerId null and recordedByPartner=false.
 * Partner picks which of their officers handled it + sets the finance
 * breakdown the same way as for shifts.
 */
export async function assignAdminJob(
  jobId: string,
  _prev: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const me = await requirePartner();
  const parsed = AssignInput.safeParse({
    partnerOfficerId: formData.get("partnerOfficerId")?.toString() ?? "",
    chargeToUs: formData.get("chargeToUs")?.toString() ?? "0",
    payToOfficer: formData.get("payToOfficer")?.toString() ?? "0",
    notes: formData.get("notes")?.toString() || null,
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  if (d.partnerOfficerId) {
    if (!(await verifyOfficerBelongsToPartner(d.partnerOfficerId, me.partnerId))) {
      return {
        error: "Officer isn't on your roster.",
        fieldErrors: { partnerOfficerId: ["Pick one of your officers"] },
      };
    }
  }
  const r = await prisma.job.updateMany({
    where: {
      id: jobId,
      handledByPartnerId: me.partnerId,
      recordedByPartner: false,
    },
    data: {
      handledByPartnerOfficerId: d.partnerOfficerId,
      partnerChargeToUsAmount: d.chargeToUs || 0,
      partnerOfficerPayAmount: d.payToOfficer || 0,
      notes: d.notes,
    },
  });
  if (r.count === 0) {
    return { error: "Job not found." };
  }
  revalidatePath("/partner/activities");
  revalidatePath("/partner/finance");
  return { success: "Saved." };
}
