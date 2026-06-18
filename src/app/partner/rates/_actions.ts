"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";

/**
 * Partner rate-card CRUD.
 *
 * Two amounts per (partner, service): chargeToUs + payToOfficer. The
 * partner manages this themselves — they know what they invoice us
 * and what they pay their own officer.
 *
 * Same pattern as elsewhere: actions call requirePartner() and scope
 * by session partnerId, never by anything in the body.
 */

export type RateFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

const Services = [
  "ALARM_RESPONSE",
  "KEYHOLDING",
  "LOCKUP",
  "UNLOCK",
  "VPI",
  "PATROL",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
] as const;

const Units = ["PER_VISIT", "PER_HOUR", "PER_MONTH"] as const;

const Input = z.object({
  service: z.enum(Services),
  chargeToUs: z.coerce.number().min(0).max(99_999_999),
  payToOfficer: z.coerce.number().min(0).max(99_999_999),
  unit: z.enum(Units),
  notes: z.string().trim().max(500).optional().nullable(),
});

function parseForm(formData: FormData) {
  return Input.safeParse({
    service: formData.get("service")?.toString() ?? "",
    chargeToUs: formData.get("chargeToUs")?.toString() ?? "0",
    payToOfficer: formData.get("payToOfficer")?.toString() ?? "0",
    unit: formData.get("unit")?.toString() ?? "PER_VISIT",
    notes: formData.get("notes")?.toString() || null,
  });
}

export async function upsertPartnerRate(
  _prev: RateFormState,
  formData: FormData,
): Promise<RateFormState> {
  const me = await requirePartner();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { service, chargeToUs, payToOfficer, unit, notes } = parsed.data;

  // Unique (partnerId, service) — upsert by composite key.
  await prisma.partnerRate.upsert({
    where: { partnerId_service: { partnerId: me.partnerId, service } },
    create: {
      partnerId: me.partnerId,
      service,
      chargeToUs,
      payToOfficer,
      unit,
      notes,
    },
    update: { chargeToUs, payToOfficer, unit, notes },
  });
  revalidatePath("/partner/rates");
  return { success: "Saved." };
}

export async function deletePartnerRate(
  id: string,
): Promise<{ ok: boolean }> {
  const me = await requirePartner();
  await prisma.partnerRate.deleteMany({
    where: { id, partnerId: me.partnerId },
  });
  revalidatePath("/partner/rates");
  return { ok: true };
}
