"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseIsoDate } from "@/lib/dates";
import type { ContractCadence, ContractStatus } from "@prisma/client";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Record a customer service agreement. */
export async function addContractAction(input: {
  customerId: string;
  title: string;
  value: number;
  cadence: string;
  startDate: string;
  endDate?: string | null;
  noticeDays?: number | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const u = await requireAdmin();
  if (!input.customerId) return { ok: false, error: "Pick a customer." };
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Give the contract a title." };
  if (!Number.isFinite(input.value) || input.value < 0) {
    return { ok: false, error: "Enter the contract value." };
  }
  const startDate = parseIsoDate(input.startDate);
  if (!startDate) return { ok: false, error: "Pick a start date." };
  const endDate = input.endDate ? parseIsoDate(input.endDate) : null;
  const cadence = (["MONTHLY", "QUARTERLY", "ANNUAL"].includes(input.cadence)
    ? input.cadence
    : "MONTHLY") as ContractCadence;

  try {
    await prisma.contract.create({
      data: {
        customerId: input.customerId,
        title,
        value: round2(input.value),
        cadence,
        startDate,
        endDate,
        noticeDays:
          input.noticeDays != null && Number.isFinite(input.noticeDays)
            ? Math.max(0, Math.round(input.noticeDays))
            : null,
        notes: input.notes?.trim() || null,
        createdByUserId: u.id,
      },
    });
  } catch (e) {
    console.error("addContract failed", e);
    return { ok: false, error: "Couldn't save the contract. Please retry." };
  }
  revalidatePath("/finance/contracts");
  return { ok: true };
}

/** Move a contract's status (Active → Expired / Cancelled, or reactivate). */
export async function updateContractStatusAction(
  id: string,
  status: ContractStatus,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.contract.update({ where: { id }, data: { status } });
  } catch (e) {
    console.error("updateContractStatus failed", e);
    return { ok: false, error: "Couldn't update the contract. Please retry." };
  }
  revalidatePath("/finance/contracts");
  return { ok: true };
}

/** Delete a contract. */
export async function deleteContractAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.contract.delete({ where: { id } });
  } catch (e) {
    console.error("deleteContract failed", e);
    return { ok: false, error: "Couldn't delete the contract. Please retry." };
  }
  revalidatePath("/finance/contracts");
  return { ok: true };
}
