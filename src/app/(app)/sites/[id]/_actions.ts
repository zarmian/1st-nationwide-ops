"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { parseRateForm, rateData } from "@/lib/rateInput";
import type { RateFormState } from "@/lib/rateMeta";

/**
 * Per-site rate overrides. One row per (site × service); saving the same
 * service overwrites. A site rate takes precedence over the customer's
 * default rate card for that service (see billForSite). Deleting one falls
 * the site back to the customer default.
 */
export async function upsertSiteRate(
  siteId: string,
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

  const existing = await prisma.siteRate.findFirst({
    where: { siteId, service: data.service },
    select: { id: true },
  });
  if (existing) {
    await prisma.siteRate.update({ where: { id: existing.id }, data });
  } else {
    await prisma.siteRate.create({ data: { siteId, ...data } });
  }

  revalidatePath(`/sites/${siteId}`);
  return { ok: true };
}

export async function deleteSiteRate(id: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  const row = await prisma.siteRate.findUnique({
    where: { id },
    select: { siteId: true },
  });
  await prisma.siteRate.delete({ where: { id } });
  if (row) revalidatePath(`/sites/${row.siteId}`);
  return { ok: true };
}
