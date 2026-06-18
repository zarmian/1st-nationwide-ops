"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePartnerOfficer } from "@/lib/authz";
import { parseUkDateTimeLocal } from "@/lib/dates";

/**
 * Partner-officer activity actions.
 *
 * The officer can only touch assignments where
 * handledByPartnerOfficerId = their seat id. They CAN'T change site,
 * customer, type, or the rate snapshots (those are partner-admin
 * fields). They CAN update arrival / departure / start / end times
 * and notes, and they can stamp the row "done" — which sets
 * completedAt (Job) or actualEndedAt (Shift) to now if not already.
 */

export type CompletionFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

const JobInput = z.object({
  kind: z.literal("JOB"),
  arrivedAt: z.string().optional().nullable(),
  departedAt: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
const ShiftInput = z.object({
  kind: z.literal("SHIFT"),
  startedAt: z.string().optional().nullable(),
  endedAt: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
const Input = z.discriminatedUnion("kind", [JobInput, ShiftInput]);

function parseForm(formData: FormData) {
  const kind = formData.get("kind")?.toString();
  if (kind === "JOB") {
    return Input.safeParse({
      kind: "JOB",
      arrivedAt: formData.get("arrivedAt")?.toString() || null,
      departedAt: formData.get("departedAt")?.toString() || null,
      notes: formData.get("notes")?.toString() || null,
    });
  }
  return Input.safeParse({
    kind: "SHIFT",
    startedAt: formData.get("startedAt")?.toString() || null,
    endedAt: formData.get("endedAt")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
  });
}

export async function updateAssignedActivity(
  encodedId: string,
  _prev: CompletionFormState,
  formData: FormData,
): Promise<CompletionFormState> {
  const me = await requirePartnerOfficer();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const isShift = encodedId.startsWith("shift-");
  const rawId = isShift ? encodedId.slice("shift-".length) : encodedId;

  if (!isShift && d.kind === "JOB") {
    const arrivedAt = parseUkDateTimeLocal(d.arrivedAt) ?? null;
    const departedAt = parseUkDateTimeLocal(d.departedAt) ?? null;
    if (arrivedAt && departedAt && departedAt <= arrivedAt) {
      return {
        error: "Departed must be after arrived.",
        fieldErrors: { departedAt: ["After arrived"] },
      };
    }
    const r = await prisma.job.updateMany({
      where: {
        id: rawId,
        handledByPartnerOfficerId: me.partnerOfficerId,
      },
      data: {
        // The officer's arrivedAt becomes the Job's startedAt — same
        // semantics as the staff-side /submit flow.
        startedAt: arrivedAt ?? undefined,
        completedAt: departedAt ?? undefined,
        notes: d.notes ?? undefined,
      },
    });
    if (r.count === 0) return { error: "Not found or not assigned to you." };
  } else if (isShift && d.kind === "SHIFT") {
    const startedAt = parseUkDateTimeLocal(d.startedAt) ?? null;
    const endedAt = parseUkDateTimeLocal(d.endedAt) ?? null;
    if (startedAt && endedAt && endedAt <= startedAt) {
      return {
        error: "End must be after start.",
        fieldErrors: { endedAt: ["After start"] },
      };
    }
    const r = await prisma.shift.updateMany({
      where: {
        id: rawId,
        handledByPartnerOfficerId: me.partnerOfficerId,
      },
      data: {
        actualStartedAt: startedAt ?? undefined,
        actualEndedAt: endedAt ?? undefined,
        notes: d.notes ?? undefined,
      },
    });
    if (r.count === 0) return { error: "Not found or not assigned to you." };
  } else {
    return { error: "Kind doesn't match the record." };
  }

  revalidatePath("/partner/m/today");
  revalidatePath(`/partner/m/activities/${encodedId}`);
  return { success: "Saved." };
}

export async function markAssignedActivityDone(
  encodedId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requirePartnerOfficer();
  const isShift = encodedId.startsWith("shift-");
  const rawId = isShift ? encodedId.slice("shift-".length) : encodedId;
  const now = new Date();

  if (isShift) {
    const r = await prisma.shift.updateMany({
      where: {
        id: rawId,
        handledByPartnerOfficerId: me.partnerOfficerId,
        actualEndedAt: null,
      },
      data: {
        status: "COMPLETED" as any,
        actualStartedAt: { set: undefined } as any, // preserved if set
        actualEndedAt: now,
      },
    });
    // updateMany doesn't support set/undefined trickery — fall back to
    // a second query to set actualStartedAt if it's currently null.
    await prisma.shift.updateMany({
      where: {
        id: rawId,
        handledByPartnerOfficerId: me.partnerOfficerId,
        actualStartedAt: null,
      },
      data: { actualStartedAt: now },
    });
    if (r.count === 0) {
      // Either not assigned to me or already done — either way no-op.
      return { ok: true };
    }
  } else {
    const r = await prisma.job.updateMany({
      where: {
        id: rawId,
        handledByPartnerOfficerId: me.partnerOfficerId,
        completedAt: null,
      },
      data: { completedAt: now },
    });
    // Backfill startedAt if it's still null.
    await prisma.job.updateMany({
      where: {
        id: rawId,
        handledByPartnerOfficerId: me.partnerOfficerId,
        startedAt: null,
      },
      data: { startedAt: now },
    });
    if (r.count === 0) {
      return { ok: true };
    }
  }
  revalidatePath("/partner/m/today");
  revalidatePath(`/partner/m/activities/${encodedId}`);
  return { ok: true };
}
