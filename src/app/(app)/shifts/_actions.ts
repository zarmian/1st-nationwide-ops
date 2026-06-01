"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseUkDateTimeLocal } from "@/lib/dates";

const SHIFT_TYPES = ["STATIC_GUARDING", "DOG_HANDLER"] as const;

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
