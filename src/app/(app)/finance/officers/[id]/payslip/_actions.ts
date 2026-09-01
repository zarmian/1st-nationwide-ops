"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseIsoDate } from "@/lib/dates";
import { sendPayslipEmail } from "@/lib/payslip";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Add a manual pay adjustment (bonus / expense / deduction …) for an officer. */
export async function addPayAdjustmentAction(
  officerId: string,
  input: {
    date: string;
    kind: string;
    label: string;
    amount: number;
    note?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const u = await requireAdmin();
  const date = parseIsoDate(input.date);
  if (!date) return { ok: false, error: "Pick a date for the adjustment." };
  const label = input.label?.trim();
  if (!label) return { ok: false, error: "Give the adjustment a short label." };
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    return { ok: false, error: "Enter a non-zero amount (negative to deduct)." };
  }
  try {
    await prisma.payAdjustment.create({
      data: {
        officerId,
        date,
        kind: input.kind?.trim() || "Other",
        label,
        amount: round2(input.amount),
        note: input.note?.trim() || null,
        createdByUserId: u.id,
      },
    });
  } catch (e) {
    console.error("addPayAdjustment failed", e);
    return { ok: false, error: "Couldn't save the adjustment. Please retry." };
  }
  revalidatePath(`/finance/officers/${officerId}/payslip`);
  revalidatePath("/finance/payroll");
  return { ok: true };
}

/** Delete a pay adjustment. */
export async function deletePayAdjustmentAction(
  id: string,
  officerId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.payAdjustment.delete({ where: { id } });
  } catch (e) {
    console.error("deletePayAdjustment failed", e);
    return { ok: false, error: "Couldn't delete the adjustment. Please retry." };
  }
  revalidatePath(`/finance/officers/${officerId}/payslip`);
  revalidatePath("/finance/payroll");
  return { ok: true };
}

/** Email the payslip PDF to the officer. */
export async function emailPayslipAction(
  officerId: string,
  from: string,
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to, true);
  if (!fromDate || !toDate) {
    return { ok: false, error: "Invalid payslip period." };
  }
  return sendPayslipEmail(officerId, fromDate, toDate);
}
