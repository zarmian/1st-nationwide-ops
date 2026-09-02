"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  getShurgardDelivery,
  deliverShurgardReport,
} from "@/lib/reports/clientReportDelivery";
import type { UkDay } from "@/lib/reports/shurgardReport";

function parseUkDay(s: string): UkDay | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Save the Shurgard daily-report delivery settings (admin only). */
export async function saveReportDeliveryAction(input: {
  on: boolean;
  recipient: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const { shurgard } = await getShurgardDelivery();
  if (!shurgard) {
    return { ok: false, error: "No customer named “Shurgard” found." };
  }
  const recipient = input.recipient?.trim() || null;
  if (recipient && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (input.on && !recipient && !shurgard.contactEmail) {
    return {
      ok: false,
      error: "Add a delivery email before turning automatic sending on.",
    };
  }
  await prisma.customer.update({
    where: { id: shurgard.id },
    data: { dailyReportOn: input.on, dailyReportRecipient: recipient },
  });
  revalidatePath("/reports");
  return { ok: true };
}

/**
 * Send the report for a specific UK day now (admin only). `toOverride` lets the
 * admin send to the address currently in the box without saving first; blank
 * falls back to the configured recipient (dailyReportRecipient → contactEmail).
 */
export async function sendReportNowAction(
  dateYmd: string,
  toOverride?: string | null,
): Promise<{ ok: boolean; error?: string; to?: string }> {
  const admin = await requireAdmin();
  const day = parseUkDay(dateYmd);
  if (!day) return { ok: false, error: "Invalid date." };
  const to = toOverride?.trim() || null;
  if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const res = await deliverShurgardReport(day, {
    to,
    triggeredBy: admin.id,
  });
  revalidatePath("/reports");
  return res.ok ? { ok: true, to: res.to } : { ok: false, error: res.reason };
}
