"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { botUsername } from "@/lib/telegram";

function currentUserId(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

/**
 * Generate a one-time code + t.me deep link for the signed-in user to link
 * their Telegram. Codes expire after 15 minutes.
 */
export async function generateTelegramLinkCode(): Promise<{
  ok: boolean;
  code?: string;
  link?: string;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  const userId = currentUserId(session);
  if (!userId) return { ok: false, error: "Not signed in." };

  const code = randomBytes(9).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramLinkCode: code,
      telegramLinkExpires: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  const uname = botUsername();
  revalidatePath("/telegram");
  return {
    ok: true,
    code,
    link: uname ? `https://t.me/${uname}?start=${code}` : undefined,
  };
}

/** Disconnect the signed-in user's Telegram. */
export async function disconnectTelegram(): Promise<{ ok: boolean }> {
  const session = await getServerSession(authOptions);
  const userId = currentUserId(session);
  if (!userId) return { ok: false };
  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramChatId: null,
      telegramLinkCode: null,
      telegramLinkExpires: null,
    },
  });
  revalidatePath("/telegram");
  return { ok: true };
}
