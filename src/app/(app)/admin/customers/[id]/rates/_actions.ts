"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { parseRateForm, rateData } from "@/lib/rateInput";
import type { RateFormState } from "@/lib/rateMeta";

/**
 * Customer default rate card. One row per (customer × service); saving the
 * same service overwrites. These apply to every site under the customer
 * unless the site sets its own rate for that service (see billForSite).
 */
export async function upsertCustomerRate(
  customerId: string,
  _prev: RateFormState,
  formData: FormData,
): Promise<RateFormState> {
  await requireAdmin();
  const parsed = parseRateForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const data = rateData(parsed.data);

  const existing = await prisma.customerRate.findFirst({
    where: { customerId, service: data.service },
    select: { id: true },
  });
  if (existing) {
    await prisma.customerRate.update({ where: { id: existing.id }, data });
  } else {
    await prisma.customerRate.create({ data: { customerId, ...data } });
  }

  revalidatePath(`/admin/customers/${customerId}/rates`);
  return { ok: true };
}

export async function deleteCustomerRate(id: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  const row = await prisma.customerRate.findUnique({
    where: { id },
    select: { customerId: true },
  });
  await prisma.customerRate.delete({ where: { id } });
  if (row) revalidatePath(`/admin/customers/${row.customerId}/rates`);
  return { ok: true };
}
