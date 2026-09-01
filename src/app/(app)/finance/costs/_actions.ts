"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseIsoDate } from "@/lib/dates";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Add a supplier cost / bill. VAT + gross are derived from net × rate. */
export async function addCostAction(input: {
  date: string;
  supplier: string;
  category: string;
  description?: string | null;
  net: number;
  vatRate: number;
  reclaimable: boolean;
  reference?: string | null;
  dueOn?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const u = await requireAdmin();
  const date = parseIsoDate(input.date);
  if (!date) return { ok: false, error: "Pick the bill date." };
  const dueOn = input.dueOn ? parseIsoDate(input.dueOn) : null;
  const supplier = input.supplier?.trim();
  if (!supplier) return { ok: false, error: "Enter the supplier's name." };
  if (!Number.isFinite(input.net) || input.net < 0) {
    return { ok: false, error: "Enter the net amount (before VAT)." };
  }
  const vatRate = Number.isFinite(input.vatRate) ? input.vatRate : 0.2;
  const net = round2(input.net);
  const vatAmount = round2(net * vatRate);
  const gross = round2(net + vatAmount);

  try {
    await prisma.supplierCost.create({
      data: {
        date,
        supplier,
        category: input.category?.trim() || "Other",
        description: input.description?.trim() || null,
        net,
        vatRate,
        vatAmount,
        gross,
        reference: input.reference?.trim() || null,
        reclaimable: input.reclaimable,
        dueOn,
        notes: input.notes?.trim() || null,
        createdByUserId: u.id,
      },
    });
  } catch (e) {
    console.error("addCost failed", e);
    return { ok: false, error: "Couldn't save the cost. Please retry." };
  }
  revalidatePath("/finance/costs");
  revalidatePath("/finance/vat");
  revalidatePath("/finance/payables");
  return { ok: true };
}

/** Mark a supplier bill paid (defaults to today) — clears it from payables. */
export async function markCostPaidAction(
  id: string,
  paidOn?: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const when = (paidOn ? parseIsoDate(paidOn) : null) ?? new Date();
  try {
    await prisma.supplierCost.update({ where: { id }, data: { paidOn: when } });
  } catch (e) {
    console.error("markCostPaid failed", e);
    return { ok: false, error: "Couldn't update the bill. Please retry." };
  }
  revalidatePath("/finance/payables");
  revalidatePath("/finance/costs");
  return { ok: true };
}

/** Mark a paid bill back to unpaid — returns it to payables. */
export async function markCostUnpaidAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.supplierCost.update({ where: { id }, data: { paidOn: null } });
  } catch (e) {
    console.error("markCostUnpaid failed", e);
    return { ok: false, error: "Couldn't update the bill. Please retry." };
  }
  revalidatePath("/finance/payables");
  revalidatePath("/finance/costs");
  return { ok: true };
}

/** Delete a supplier cost. */
export async function deleteCostAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.supplierCost.delete({ where: { id } });
  } catch (e) {
    console.error("deleteCost failed", e);
    return { ok: false, error: "Couldn't delete the cost. Please retry." };
  }
  revalidatePath("/finance/costs");
  revalidatePath("/finance/vat");
  return { ok: true };
}
