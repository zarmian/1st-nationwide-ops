"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseUkDateTimeLocal } from "@/lib/dates";

const SHIFT_TYPES = ["STATIC_GUARDING", "DOG_HANDLER"] as const;
const HANDLER_KINDS = ["officer", "partner"] as const;

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
  await requireStaff();
  const parsed = parseNew(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  await prisma.shift.create({
    data: {
      siteId: d.siteId,
      officerId: d.officerId && d.officerId !== "" ? d.officerId : null,
      type: d.type as any,
      scheduledStartsAt: parseUkDateTimeLocal(d.scheduledStartsAt)!,
      scheduledEndsAt: parseUkDateTimeLocal(d.scheduledEndsAt)!,
      checkIntervalMin: d.checkIntervalMin,
      graceMinutes: d.graceMinutes,
      notes: d.notes,
    },
  });
  revalidatePath("/shifts");
  redirect("/shifts");
}

export async function updateShift(
  shiftId: string,
  _prev: ShiftFormState,
  formData: FormData,
): Promise<ShiftFormState> {
  await requireStaff();
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
    select: { id: true },
  });
  if (!existing) return { error: "Shift not found" };
  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      siteId: d.siteId,
      officerId: d.officerId && d.officerId !== "" ? d.officerId : null,
      type: d.type as any,
      scheduledStartsAt: parseUkDateTimeLocal(d.scheduledStartsAt)!,
      scheduledEndsAt: parseUkDateTimeLocal(d.scheduledEndsAt)!,
      checkIntervalMin: d.checkIntervalMin,
      graceMinutes: d.graceMinutes,
      notes: d.notes,
    },
  });
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
    select: { id: true, officerId: true, status: true },
  });
  if (!shift) return { ok: false, error: "Not found" };
  if (shift.officerId !== me.id && me.role === "OFFICER") {
    return { ok: false, error: "Not your shift" };
  }
  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: "COMPLETED",
      actualEndedAt: new Date(),
    },
  });
  revalidatePath("/m/today");
  revalidatePath("/shifts");
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

  await prisma.shift.create({
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
  });
  revalidatePath("/shifts");
  revalidatePath("/dispatch");
  revalidatePath("/partner/activities");
  redirect("/shifts");
}
