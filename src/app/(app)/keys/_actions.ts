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
