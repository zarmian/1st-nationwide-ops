"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { notifyKeyHandover } from "@/lib/notifications";
import { requireStaff } from "@/lib/authz";

const HandoverInput = z.object({
  toUserId: z
    .string()
    .uuid("Pick a recipient")
    .or(z.literal(""))
    .nullable()
    .optional(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export type HandoverState = {
  error?: string;
  ok?: boolean;
};

export async function handoverKey(
  keyId: string,
  _prev: HandoverState,
  formData: FormData,
): Promise<HandoverState> {
  const me = await requireStaff();
  const signedOffById = me.id;
  const raw = {
    toUserId: formData.get("toUserId")?.toString() || null,
    reason: formData.get("reason")?.toString() || null,
  };
  const parsed = HandoverInput.safeParse(raw);
  if (!parsed.success) {
    return { error: "Pick a recipient or 'Back to us'." };
  }
  const { reason } = parsed.data;
  const toUserId =
    parsed.data.toUserId && parsed.data.toUserId !== ""
      ? parsed.data.toUserId
      : null;

  const key = await prisma.key.findUnique({
    where: { id: keyId },
    select: { currentHolderUserId: true, status: true },
  });
  if (!key) return { error: "Key not found." };

  const newStatus = toUserId ? "WITH_OFFICER" : "WITH_US";

  const movement = await prisma.keyMovement.create({
    data: {
      keyId,
      fromUserId: key.currentHolderUserId ?? null,
      toUserId,
      reason: reason ?? null,
      signedOffById: signedOffById ?? null,
    },
    select: { id: true },
  });
  await prisma.key.update({
    where: { id: keyId },
    data: {
      currentHolderUserId: toUserId,
      status: newStatus as any,
    },
  });

  notifyKeyHandover(movement.id).catch((e) =>
    console.error("notifyKeyHandover failed", e),
  );

  revalidatePath(`/keys/${keyId}`);
  revalidatePath("/keys");
  return { ok: true };
}

// ── Key edit ────────────────────────────────────────────────────────────

// Must match the KeyType enum in schema.prisma (KEY | FOB | PADLOCK | CODE).
// CARD/REMOTE/OTHER used to be offered here but aren't valid enum values, so
// saving one threw a Prisma invalid-enum error at write time — removed.
const KeyTypes = ["KEY", "FOB", "PADLOCK", "CODE"] as const;
const KeyStatuses = [
  "WITH_US",
  "WITH_OFFICER",
  "WITH_CUSTOMER",
  "LOST",
  "RETIRED",
] as const;

const KeyUpdateInput = z.object({
  label: z.string().trim().min(1, "Label required").max(120),
  internalNo: z.string().trim().max(60).optional().nullable(),
  type: z.enum(KeyTypes),
  status: z.enum(KeyStatuses),
  notes: z.string().trim().max(2000).optional().nullable(),
  duplicable: z.boolean().optional(),
});

export type KeyUpdateState = { error?: string; ok?: boolean };

export async function updateKey(
  keyId: string,
  _prev: KeyUpdateState,
  formData: FormData,
): Promise<KeyUpdateState> {
  await requireStaff();
  const raw = {
    label: formData.get("label")?.toString() ?? "",
    internalNo: formData.get("internalNo")?.toString() || null,
    type: formData.get("type")?.toString() ?? "KEY",
    status: formData.get("status")?.toString() ?? "WITH_US",
    notes: formData.get("notes")?.toString() || null,
    duplicable: formData.get("duplicable") === "on",
  };
  const parsed = KeyUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await prisma.key.update({
    where: { id: keyId },
    data: {
      label: parsed.data.label,
      internalNo: parsed.data.internalNo,
      type: parsed.data.type as any,
      status: parsed.data.status as any,
      notes: parsed.data.notes,
      duplicable: parsed.data.duplicable ?? true,
    },
  });
  revalidatePath(`/keys/${keyId}`);
  revalidatePath("/keys");
  return { ok: true };
}

// ── KeySet edit + bulk handover ─────────────────────────────────────────

const KeySetUpdateInput = z.object({
  label: z.string().trim().min(1, "Label required").max(120),
  internalNo: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  photoUrl: z.string().url().or(z.literal("")).optional().nullable(),
});

export type KeySetUpdateState = { error?: string; ok?: boolean };

export async function updateKeySet(
  setId: string,
  _prev: KeySetUpdateState,
  formData: FormData,
): Promise<KeySetUpdateState> {
  await requireStaff();
  const raw = {
    label: formData.get("label")?.toString() ?? "",
    internalNo: formData.get("internalNo")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
    photoUrl: formData.get("photoUrl")?.toString() || null,
  };
  const parsed = KeySetUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await prisma.keySet.update({
    where: { id: setId },
    data: {
      label: parsed.data.label,
      internalNo: parsed.data.internalNo,
      notes: parsed.data.notes,
      photoUrl: parsed.data.photoUrl || null,
    },
  });
  revalidatePath(`/key-sets/${setId}`);
  revalidatePath("/keys");
  return { ok: true };
}

/**
 * Hand over every key in a set in one go. Each key still gets its own
 * KeyMovement row (chain-of-custody stays per-key) so the audit trail is
 * unchanged; the only thing this skips is the per-key click-through.
 */
export async function handoverKeySet(
  setId: string,
  _prev: HandoverState,
  formData: FormData,
): Promise<HandoverState> {
  const me = await requireStaff();
  const raw = {
    toUserId: formData.get("toUserId")?.toString() || null,
    reason: formData.get("reason")?.toString() || null,
  };
  const parsed = HandoverInput.safeParse(raw);
  if (!parsed.success) {
    return { error: "Pick a recipient or 'Back to us'." };
  }
  const toUserId =
    parsed.data.toUserId && parsed.data.toUserId !== ""
      ? parsed.data.toUserId
      : null;
  const reason = parsed.data.reason ?? null;

  const keys = await prisma.key.findMany({
    where: { keySetId: setId },
    select: { id: true, currentHolderUserId: true },
  });
  if (keys.length === 0) {
    return { error: "Set has no keys." };
  }

  const newStatus = toUserId ? "WITH_OFFICER" : "WITH_US";
  const createdMovements: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const k of keys) {
      const m = await tx.keyMovement.create({
        data: {
          keyId: k.id,
          fromUserId: k.currentHolderUserId ?? null,
          toUserId,
          reason,
          signedOffById: me.id,
        },
        select: { id: true },
      });
      createdMovements.push(m.id);
      await tx.key.update({
        where: { id: k.id },
        data: {
          currentHolderUserId: toUserId,
          status: newStatus as any,
        },
      });
    }
  });

  for (const id of createdMovements) {
    notifyKeyHandover(id).catch((e) =>
      console.error("notifyKeyHandover failed", e),
    );
  }

  revalidatePath(`/key-sets/${setId}`);
  revalidatePath("/keys");
  return { ok: true };
}
