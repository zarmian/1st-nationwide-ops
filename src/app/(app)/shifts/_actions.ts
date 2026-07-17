"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseUkDateTimeLocal } from "@/lib/dates";
import {
  applyBillingToShift,
  applyPayToShift,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
  payForOfficer,
  roundUpToHalfHour,
} from "@/lib/billing";
import { newPublicToken } from "@/lib/tokens";
import { isSmsConfigured, normaliseE164, sendSms } from "@/lib/sms";
import { diffFields, logActivity } from "@/lib/audit";
import { dutyUrl } from "@/lib/dutyLink";

const SHIFT_TYPES = ["STATIC_GUARDING", "DOG_HANDLER"] as const;
const HANDLER_KINDS = ["officer", "partner"] as const;
const CREATE_HANDLER_KINDS = ["own", "partner"] as const;

const CreateHandlerInput = z.object({
  handlerKind: z.enum(CREATE_HANDLER_KINDS).default("own"),
  handlerPartnerId: z.string().uuid().or(z.literal("")).optional().nullable(),
  linkPhone: z.string().trim().max(32).optional().nullable(),
  officerName: z.string().trim().max(120).optional().nullable(),
});

const NewShiftInput = z
  .object({
    siteId: z.string().uuid("Pick a site"),
    officerId: z.string().uuid().or(z.literal("")).optional().nullable(),
    type: z.enum(SHIFT_TYPES),
    scheduledStartsAt: z.string().min(1, "Start time required"),
    scheduledEndsAt: z.string().min(1, "End time required"),
    checkIntervalMin: z.coerce.number().int().min(5).max(720).default(60),
    graceMinutes: z.coerce.number().int().min(0).max(120).default(15),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    const start = parseUkDateTimeLocal(d.scheduledStartsAt) ?? new Date(NaN);
    const end = parseUkDateTimeLocal(d.scheduledEndsAt) ?? new Date(NaN);
    if (!Number.isFinite(start.getTime()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledStartsAt"],
        message: "Invalid start time",
      });
    if (!Number.isFinite(end.getTime()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEndsAt"],
        message: "Invalid end time",
      });
    if (start.getTime() >= end.getTime())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEndsAt"],
        message: "End must be after start",
      });
  });

export type ShiftFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseNew(formData: FormData) {
  return NewShiftInput.safeParse({
    siteId: formData.get("siteId")?.toString() ?? "",
    officerId: formData.get("officerId")?.toString() || null,
    type: formData.get("type")?.toString() ?? "STATIC_GUARDING",
    scheduledStartsAt: formData.get("scheduledStartsAt")?.toString() ?? "",
    scheduledEndsAt: formData.get("scheduledEndsAt")?.toString() ?? "",
    checkIntervalMin: formData.get("checkIntervalMin")?.toString() ?? "60",
    graceMinutes: formData.get("graceMinutes")?.toString() ?? "15",
    notes: formData.get("notes")?.toString() || null,
  });
}

export async function createShift(
  _prev: ShiftFormState,
  formData: FormData,
): Promise<ShiftFormState> {
  const me = await requireStaff();
  const parsed = parseNew(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const handler = CreateHandlerInput.safeParse({
    handlerKind: formData.get("handlerKind")?.toString() ?? "own",
    handlerPartnerId: formData.get("handlerPartnerId")?.toString() || null,
    linkPhone: formData.get("linkPhone")?.toString() || null,
    officerName: formData.get("officerName")?.toString() || null,
  });
  if (!handler.success) {
    return { error: "Please fix the errors below." };
  }
  const d = parsed.data;
  const h = handler.data;

  // Resolve the link phone (E.164). Required for partner-handled shifts;
  // optional for own officers (falls back to the officer's saved number).
  let linkPhone: string | null = null;
  if (h.linkPhone) {
    const e164 = normaliseE164(h.linkPhone);
    if (!e164) {
      return {
        error: "Please fix the errors below.",
        fieldErrors: { linkPhone: ["Enter a valid UK mobile number"] },
      };
    }
    linkPhone = e164;
  }

  let officerId: string | null =
    d.officerId && d.officerId !== "" ? d.officerId : null;
  let handledByPartnerId: string | null = null;

  if (h.handlerKind === "partner") {
    officerId = null; // partner-handled — no internal officer
    if (!h.handlerPartnerId) {
      return {
        error: "Please fix the errors below.",
        fieldErrors: { handlerPartnerId: ["Pick a partner"] },
      };
    }
    const partner = await prisma.partner.findUnique({
      where: { id: h.handlerPartnerId },
      select: { id: true, role: true, active: true },
    });
    if (!partner || !partner.active) {
      return {
        error: "Partner not found or inactive.",
        fieldErrors: { handlerPartnerId: ["Unknown or inactive"] },
      };
    }
    if (partner.role !== "SUBCONTRACTOR" && partner.role !== "BOTH") {
      return {
        error: "Only subcontracting partners can take a shift.",
        fieldErrors: { handlerPartnerId: ["Not a subcontracting partner"] },
      };
    }
    handledByPartnerId = partner.id;
    if (!linkPhone) {
      return {
        error: "Please fix the errors below.",
        fieldErrors: { linkPhone: ["Officer mobile is required for partners"] },
      };
    }
  } else if (officerId && !linkPhone) {
    // Own officer with an account — default the link number to theirs.
    const officer = await prisma.user.findUnique({
      where: { id: officerId },
      select: { phone: true },
    });
    if (officer?.phone) linkPhone = normaliseE164(officer.phone);
  }

  const created = await prisma.shift.create({
    data: {
      siteId: d.siteId,
      officerId,
      handledByPartnerId,
      type: d.type as any,
      scheduledStartsAt: parseUkDateTimeLocal(d.scheduledStartsAt)!,
      scheduledEndsAt: parseUkDateTimeLocal(d.scheduledEndsAt)!,
      checkIntervalMin: d.checkIntervalMin,
      graceMinutes: d.graceMinutes,
      notes: d.notes,
      publicToken: newPublicToken(),
      linkPhone,
      officerNameRaw: h.officerName || null,
    },
    select: { id: true },
  });

  await logActivity({
    entity: "Shift",
    entityId: created.id,
    action: "created",
    userId: me.id,
  });

  revalidatePath("/shifts");
  // Land on the detail page so the officer link + Send-SMS is right there.
  redirect(`/shifts/${created.id}`);
}

export async function updateShift(
  shiftId: string,
  _prev: ShiftFormState,
  formData: FormData,
): Promise<ShiftFormState> {
  const me = await requireStaff();
  const parsed = parseNew(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const existing = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      status: true,
      siteId: true,
      officerId: true,
      type: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      checkIntervalMin: true,
      graceMinutes: true,
      notes: true,
    },
  });
  if (!existing) return { error: "Shift not found" };

  const after = {
    siteId: d.siteId,
    officerId: d.officerId && d.officerId !== "" ? d.officerId : null,
    type: d.type as any,
    scheduledStartsAt: parseUkDateTimeLocal(d.scheduledStartsAt)!,
    scheduledEndsAt: parseUkDateTimeLocal(d.scheduledEndsAt)!,
    checkIntervalMin: d.checkIntervalMin,
    graceMinutes: d.graceMinutes,
    notes: d.notes ?? null,
  };
  await prisma.shift.update({ where: { id: shiftId }, data: after });

  // Record who changed what, with a timestamp. The detail page surfaces
  // this — the requirement is that anything edited (especially after the
  // shift is done) is visible in the log.
  const diff = diffFields(existing as Record<string, unknown>, after);
  if (Object.keys(diff).length > 0) {
    await logActivity({
      entity: "Shift",
      entityId: shiftId,
      action: existing.status === "COMPLETED" ? "edited_after_completion" : "edited",
      userId: me.id,
      diff,
    });
  }

  revalidatePath("/shifts");
  revalidatePath(`/shifts/${shiftId}`);
  redirect(`/shifts/${shiftId}`);
}

export async function deleteShift(
  shiftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  // Cancel any live dispatch jobs tied to this shift before deleting it.
  // Job.shiftId is ON DELETE SetNull so the rows would survive anyway, but
  // they'd hang around on /dispatch as orphans — the bug the user reported
  // with the Tissington Court row.
  await prisma.job.updateMany({
    where: {
      shiftId,
      status: {
        in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING"],
      },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: me.id,
    },
  });
  await prisma.shift.delete({ where: { id: shiftId } });
  revalidatePath("/shifts");
  revalidatePath("/dispatch");
  return { ok: true };
}

/**
 * Text the officer their duty link. Sends immediately (not via the queue)
 * so the admin gets instant success/failure feedback, then records a
 * Notification row + audit entry for the log.
 */
export async function sendShiftLinkSms(
  shiftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      publicToken: true,
      linkPhone: true,
      site: { select: { name: true, code: true } },
      officer: { select: { phone: true } },
    },
  });
  if (!shift) return { ok: false, error: "Shift not found" };
  if (!shift.publicToken) return { ok: false, error: "This shift has no link." };

  const to =
    shift.linkPhone ??
    (shift.officer?.phone ? normaliseE164(shift.officer.phone) : null);
  if (!to) {
    return {
      ok: false,
      error: "No mobile number on this shift. Add one, then resend.",
    };
  }
  if (!isSmsConfigured()) {
    return {
      ok: false,
      error: "SMS isn't configured yet (SMS Works token missing in Vercel).",
    };
  }

  const siteLabel = shift.site.code
    ? `${shift.site.code} ${shift.site.name}`
    : shift.site.name;
  const url = dutyUrl(shift.publicToken);
  const body = `1NW: Your shift at ${siteLabel}. Tap to start, check in and end on site: ${url}`;
  const res = await sendSms({ to, body });

  await prisma.notification.create({
    data: {
      channel: "SMS",
      kind: "SHIFT_LINK",
      recipientNumber: to,
      templateName: "SHIFT_LINK",
      templateParams: [],
      bodyText: body,
      bodyPreview: body.slice(0, 240),
      status: res.ok ? "SENT" : "FAILED",
      sentAt: res.ok ? new Date() : null,
      attempts: 1,
      error: res.ok ? null : res.error.slice(0, 1000),
      eventEntity: "Shift",
      eventEntityId: shiftId,
    },
  });
  await logActivity({
    entity: "Shift",
    entityId: shiftId,
    action: "link_sent",
    userId: me.id,
    diff: { sentTo: to },
  });

  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/shifts/${shiftId}`);
  return { ok: true };
}

// ── Officer self-actions on /m/today ──────────────────────────────────────

export async function startShift(
  shiftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, officerId: true, status: true },
  });
  if (!shift) return { ok: false, error: "Not found" };
  if (shift.officerId && shift.officerId !== me.id) {
    return { ok: false, error: "Not your shift" };
  }
  if (shift.status === "COMPLETED" || shift.status === "ABANDONED") {
    return { ok: false, error: "Shift already closed" };
  }
  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: "IN_PROGRESS",
      actualStartedAt: new Date(),
      officerId: shift.officerId ?? me.id, // claim if unassigned
    },
  });
  revalidatePath("/m/today");
  revalidatePath("/shifts");
  revalidatePath(`/shifts/${shiftId}`);
  return { ok: true };
}

export async function endShift(
  shiftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      siteId: true,
      officerId: true,
      type: true,
      status: true,
      scheduledStartsAt: true,
      actualStartedAt: true,
    },
  });
  if (!shift) return { ok: false, error: "Not found" };
  if (shift.officerId !== me.id && me.role === "OFFICER") {
    return { ok: false, error: "Not your shift" };
  }
  const endedAt = new Date();
  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: "COMPLETED",
      actualEndedAt: endedAt,
    },
  });

  // Snapshot finance now that we know how long the shift actually ran
  // (PER_HOUR rates depend on duration). Officer pay only when an
  // internal officer attended.
  const rateService = jobTypeToRateService(shift.type);
  if (rateService) {
    const at = shift.scheduledStartsAt;
    const dur = durationMinutes(shift.actualStartedAt, endedAt);
    const bill = await billForSite(shift.siteId, rateService, dur);
    await applyBillingToShift(shift.id, bill, at);
    if (shift.officerId) {
      const pay = await payForOfficer(shift.officerId, rateService, dur);
      await applyPayToShift(shift.id, pay, at);
    }
  }

  revalidatePath("/m/today");
  revalidatePath("/shifts");
  revalidatePath("/finance");
  revalidatePath(`/shifts/${shiftId}`);
  return { ok: true };
}

// ── Record an already-completed shift ─────────────────────────────────────
// Mirrors /dispatch/callouts/new for jobs: staff log a shift after the
// fact (own officer attended, or a partner did it). Lands at status
// COMPLETED with actualStartedAt/EndedAt filled in. The scheduledStarts/
// EndsAt mirror the actuals so existing /shifts queries that anchor on
// scheduled time still surface the row.
//
// When handlerKind=partner, the partner becomes the row's owner via
// handledByPartnerId. Their officer (handledByPartnerOfficerId) isn't
// known here — the partner fills that in on their own portal. The row
// shows up on /partner/activities as "1NW logged".

const CompletedShiftInput = z
  .object({
    siteId: z.string().uuid("Pick a site"),
    type: z.enum(SHIFT_TYPES),
    handlerKind: z.enum(HANDLER_KINDS).default("officer"),
    officerId: z.string().trim().optional().nullable(),
    handlerPartnerId: z.string().trim().optional().nullable(),
    startedAt: z.string().min(1, "Started time required"),
    endedAt: z.string().min(1, "Ended time required"),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.handlerKind === "officer") {
      if (!d.officerId || d.officerId === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["officerId"],
          message: "Pick an officer",
        });
      }
    } else {
      if (!d.handlerPartnerId || d.handlerPartnerId === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["handlerPartnerId"],
          message: "Pick a partner",
        });
      }
    }
    const start = parseUkDateTimeLocal(d.startedAt) ?? new Date(NaN);
    const end = parseUkDateTimeLocal(d.endedAt) ?? new Date(NaN);
    if (!Number.isFinite(start.getTime()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "Invalid time",
      });
    if (!Number.isFinite(end.getTime()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "Invalid time",
      });
    if (start.getTime() >= end.getTime())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "Ended must be after Started",
      });
  });

export async function recordCompletedShift(
  _prev: ShiftFormState,
  formData: FormData,
): Promise<ShiftFormState> {
  await requireStaff();
  const parsed = CompletedShiftInput.safeParse({
    siteId: formData.get("siteId")?.toString() ?? "",
    type: formData.get("type")?.toString() ?? "STATIC_GUARDING",
    handlerKind: formData.get("handlerKind")?.toString() ?? "officer",
    officerId: formData.get("officerId")?.toString() || null,
    handlerPartnerId: formData.get("handlerPartnerId")?.toString() || null,
    startedAt: formData.get("startedAt")?.toString() ?? "",
    endedAt: formData.get("endedAt")?.toString() ?? "",
    notes: formData.get("notes")?.toString() || null,
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const start = parseUkDateTimeLocal(d.startedAt)!;
  const end = parseUkDateTimeLocal(d.endedAt)!;

  if (d.handlerKind === "partner") {
    const partner = await prisma.partner.findUnique({
      where: { id: d.handlerPartnerId! },
      select: { id: true, role: true, active: true },
    });
    if (!partner || !partner.active) {
      return {
        error: "Partner not found or inactive.",
        fieldErrors: { handlerPartnerId: ["Unknown or inactive"] },
      };
    }
    if (partner.role !== "SUBCONTRACTOR" && partner.role !== "BOTH") {
      return {
        error: "Only subcontracting partners can take a shift.",
        fieldErrors: { handlerPartnerId: ["Not a subcontracting partner"] },
      };
    }
  }

  const created = await prisma.shift.create({
    data: {
      siteId: d.siteId,
      type: d.type as any,
      // For officer-handled: set officerId; partner-handled: leave null
      // and the partner becomes the row owner via handledByPartnerId.
      officerId:
        d.handlerKind === "officer" && d.officerId ? d.officerId : null,
      handledByPartnerId:
        d.handlerKind === "partner" ? d.handlerPartnerId! : null,
      // handledByPartnerOfficerId stays null — partner fills it in on
      // their own portal.
      // Scheduled times mirror actuals so /shifts queries that anchor on
      // scheduledStartsAt still see the row.
      scheduledStartsAt: start,
      scheduledEndsAt: end,
      actualStartedAt: start,
      actualEndedAt: end,
      status: "COMPLETED" as any,
      // Disable check-in cron on after-the-fact rows.
      checkIntervalMin: 0,
      graceMinutes: 0,
      notes: d.notes,
      // recordedByPartner stays false — we (1NW staff) recorded this.
    },
    select: { id: true },
  });

  // Snapshot rates so /finance picks up the shift immediately. Same
  // pattern as recordDispatcherCallout / submission flows for jobs +
  // visits. Officer pay only when WE attended (handlerKind=officer);
  // partner-handled shifts have null paidAmount — the cost is the
  // partner's chargeToUs which they enter on their portal.
  const rateService = jobTypeToRateService(d.type);
  if (rateService) {
    // Accounting date = the shift's scheduled start (= start for this
    // recorded-after-the-fact shift).
    const dur = durationMinutes(start, end);
    const bill = await billForSite(d.siteId, rateService, dur);
    await applyBillingToShift(created.id, bill, start);
    if (d.handlerKind === "officer" && d.officerId) {
      const pay = await payForOfficer(d.officerId, rateService, dur);
      await applyPayToShift(created.id, pay, start);
    }
  }

  revalidatePath("/shifts");
  revalidatePath("/finance");
  revalidatePath("/dispatch");
  revalidatePath("/partner/activities");
  redirect("/shifts");
}
