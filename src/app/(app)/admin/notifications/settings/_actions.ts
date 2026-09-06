"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  NOTIFICATION_KINDS,
  type NotifAudience,
  type NotifChannel,
} from "@/lib/notificationSettings";

export type RoutingSaveState = {
  ok?: boolean;
  error?: string;
  savedCount?: number;
};

function on(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

/**
 * Persist the whole routing matrix in one go. For each kind we only trust the
 * toggles that are meaningful for it (its audiences/channels) — everything else
 * is forced off — so the stored row can never claim, say, "to officer" for an
 * office-only alert.
 */
export async function saveNotificationSettings(
  _prev: RoutingSaveState,
  formData: FormData,
): Promise<RoutingSaveState> {
  const admin = await requireAdmin();

  const writes = NOTIFICATION_KINDS.map((meta) => {
    const k = meta.kind;
    const has = (a: NotifAudience) => meta.audiences.includes(a);
    const via = (c: NotifChannel) => meta.channels.includes(c);
    const row = {
      enabled: on(formData, `${k}.enabled`),
      toAdmin: has("ADMIN") && on(formData, `${k}.toAdmin`),
      toDispatcher: has("DISPATCHER") && on(formData, `${k}.toDispatcher`),
      toOfficer: has("OFFICER") && on(formData, `${k}.toOfficer`),
      viaTelegram: via("TELEGRAM") && on(formData, `${k}.viaTelegram`),
      viaSms: via("SMS") && on(formData, `${k}.viaSms`),
      viaWhatsapp: via("WHATSAPP") && on(formData, `${k}.viaWhatsapp`),
    };
    return prisma.notificationSetting.upsert({
      where: { kind: k },
      create: { kind: k, ...row, updatedByUserId: admin.id },
      update: { ...row, updatedByUserId: admin.id },
    });
  });

  try {
    await prisma.$transaction(writes);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't save settings." };
  }

  revalidatePath("/admin/notifications/settings");
  return { ok: true, savedCount: writes.length };
}

/**
 * Clear every saved override so all notifications fall back to the built-in
 * recommended defaults.
 */
export async function resetNotificationSettings(): Promise<RoutingSaveState> {
  await requireAdmin();
  await prisma.notificationSetting.deleteMany({});
  revalidatePath("/admin/notifications/settings");
  return { ok: true };
}
