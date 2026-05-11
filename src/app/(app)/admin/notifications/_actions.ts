"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { drainQueue } from "@/lib/notifications";

export async function retryNotification(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const n = await prisma.notification.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!n) return { ok: false, error: "Not found" };
  if (n.status !== "FAILED" && n.status !== "SKIPPED") {
    return { ok: false, error: "Only FAILED or SKIPPED can be retried" };
  }
  await prisma.notification.update({
    where: { id },
    data: { status: "PENDING", error: null },
  });
  revalidatePath("/admin/notifications");
  return { ok: true };
}

export async function flushQueueNow(): Promise<{
  ok: boolean;
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  await requireAdmin();
  const result = await drainQueue();
  revalidatePath("/admin/notifications");
  return { ok: true, ...result };
}

export async function deleteNotification(
  id: string,
): Promise<{ ok: boolean }> {
  await requireAdmin();
  await prisma.notification.delete({ where: { id } });
  revalidatePath("/admin/notifications");
  return { ok: true };
}
