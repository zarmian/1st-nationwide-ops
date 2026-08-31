"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseIsoDate } from "@/lib/dates";

const CADENCES = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_OFF"] as const;

export async function addRecurringCharge(formData: FormData): Promise<void> {
  await requireAdmin();
  const customerId = String(formData.get("customerId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const cadenceRaw = String(formData.get("cadence") ?? "MONTHLY");
  const cadence = (CADENCES as readonly string[]).includes(cadenceRaw)
    ? (cadenceRaw as (typeof CADENCES)[number])
    : "MONTHLY";
  const service = String(formData.get("service") ?? "").trim() || null;
  const startDate = parseIsoDate(String(formData.get("startDate") ?? ""));
  const endDate = parseIsoDate(String(formData.get("endDate") ?? ""), true);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (
    !customerId ||
    !description ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !startDate
  ) {
    return;
  }

  await prisma.recurringCharge.create({
    data: {
      customerId,
      description,
      amount,
      service,
      cadence,
      startDate,
      endDate,
      notes,
    },
  });
  revalidatePath("/finance/recurring");
}

export async function toggleRecurringCharge(
  id: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  await requireAdmin();
  await prisma.recurringCharge.update({ where: { id }, data: { active } });
  revalidatePath("/finance/recurring");
  return { ok: true };
}

/**
 * Remove a charge. If it has already been billed (has runs on invoices), we
 * only deactivate it — deleting would drop the audit link. Never billed → hard
 * delete.
 */
export async function deleteRecurringCharge(
  id: string,
): Promise<{ ok: boolean; deactivatedOnly?: boolean }> {
  await requireAdmin();
  const runs = await prisma.recurringChargeRun.count({
    where: { recurringChargeId: id },
  });
  if (runs > 0) {
    await prisma.recurringCharge.update({
      where: { id },
      data: { active: false },
    });
    revalidatePath("/finance/recurring");
    return { ok: true, deactivatedOnly: true };
  }
  await prisma.recurringCharge.delete({ where: { id } });
  revalidatePath("/finance/recurring");
  return { ok: true };
}
