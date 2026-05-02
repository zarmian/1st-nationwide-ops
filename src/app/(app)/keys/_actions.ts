"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

async function requireStaff() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!role || !["ADMIN", "DISPATCHER"].includes(role)) {
    throw new Error("Not authorised");
  }
  return (session?.user as any)?.id as string | undefined;
}

export async function handoverKey(
  keyId: string,
  _prev: HandoverState,
  formData: FormData,
): Promise<HandoverState> {
  const signedOffById = await requireStaff();
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

  await prisma.$transaction([
    prisma.keyMovement.create({
      data: {
        keyId,
        fromUserId: key.currentHolderUserId ?? null,
        toUserId,
        reason: reason ?? null,
        signedOffById: signedOffById ?? null,
      },
    }),
    prisma.key.update({
      where: { id: keyId },
      data: {
        currentHolderUserId: toUserId,
        status: newStatus as any,
      },
    }),
  ]);
  revalidatePath(`/keys/${keyId}`);
  revalidatePath("/keys");
  return { ok: true };
}
