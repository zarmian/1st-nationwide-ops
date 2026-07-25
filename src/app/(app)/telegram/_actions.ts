"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  botUsername,
  getWebhookInfo,
  setWebhook,
  webhookUrl,
} from "@/lib/telegram";

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

/**
 * Point Telegram at our webhook. Admin-only, one-time (or after the secret
 * changes). Uses the server-side token + secret, so the admin never handles
 * the token by hand.
 */
export async function registerTelegramWebhook(): Promise<{
  ok: boolean;
  url?: string;
  error?: string;
}> {
  await requireAdmin();
  const url = webhookUrl();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!url) {
    return {
      ok: false,
      error: "NEXTAUTH_URL isn't set, so I can't work out the webhook address.",
    };
  }
  if (!secret) {
    return {
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET isn't set in the environment yet.",
    };
  }
  const res = await setWebhook(url, secret);
  return res.ok ? { ok: true, url } : { ok: false, error: res.error };
}

/** Read back Telegram's current webhook registration (admin-only). */
export async function checkTelegramWebhook(): Promise<{
  ok: boolean;
  url?: string;
  pending?: number;
  lastError?: string;
  error?: string;
}> {
  await requireAdmin();
  const info = await getWebhookInfo();
  if (!info.ok) return { ok: false, error: info.error };
  return {
    ok: true,
    url: info.url,
    pending: info.pendingUpdateCount,
    lastError: info.lastErrorMessage,
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
