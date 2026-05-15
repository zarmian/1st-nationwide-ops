"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";

const SERVICES = [
  "ALARM_RESPONSE",
  "KEYHOLDING",
  "LOCKUP",
  "UNLOCK",
  "VPI",
  "PATROL",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
  "ANNUAL_SUBSCRIPTION",
  "SITE_SETUP",
] as const;

const UNITS = ["PER_VISIT", "PER_HOUR", "PER_MONTH", "PER_YEAR", "FIXED"] as const;

const RateInput = z.object({
  officerId: z.string().uuid().or(z.literal("")).nullable(),
  service: z.enum(SERVICES),
  amount: z.coerce.number().min(0).max(100000),
  unit: z.enum(UNITS),
  currency: z.string().trim().min(3).max(3).default("GBP"),
  includedMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(1440)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  excessRatePerMin: z
    .union([z.literal(""), z.coerce.number().min(0).max(1000)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type RateState = { error?: string; fieldErrors?: Record<string, string[]> };

function parse(formData: FormData) {
  const officerRaw = formData.get("officerId")?.toString() ?? "";
  return RateInput.safeParse({
    officerId: officerRaw === "" || officerRaw === "default" ? null : officerRaw,
    service: formData.get("service")?.toString() ?? "ALARM_RESPONSE",
    amount: formData.get("amount")?.toString() ?? "0",
    unit: formData.get("unit")?.toString() ?? "PER_VISIT",
    currency: (formData.get("currency")?.toString() ?? "GBP").toUpperCase(),
    includedMinutes: formData.get("includedMinutes")?.toString() ?? "",
    excessRatePerMin: formData.get("excessRatePerMin")?.toString() ?? "",
    notes: formData.get("notes")?.toString() || null,
  });
}

export async function upsertOfficerRate(
  _prev: RateState,
  formData: FormData,
): Promise<RateState> {
  await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const officerId = d.officerId && d.officerId !== "" ? d.officerId : null;

  // Custom upsert because the unique key includes a nullable column.
  const existing = await prisma.officerRate.findFirst({
    where: { officerId, service: d.service as any },
    select: { id: true },
  });

  const data = {
    officerId,
    service: d.service as any,
    amount: new Prisma.Decimal(d.amount),
    currency: d.currency,
    unit: d.unit as any,
    includedMinutes: d.includedMinutes ?? null,
    excessRatePerMin:
      d.excessRatePerMin != null ? new Prisma.Decimal(d.excessRatePerMin) : null,
    notes: d.notes,
  };

  if (existing) {
    await prisma.officerRate.update({ where: { id: existing.id }, data });
  } else {
    await prisma.officerRate.create({ data });
  }

  revalidatePath("/admin/officer-rates");
  return {};
}

export async function deleteOfficerRate(
  id: string,
): Promise<{ ok: boolean }> {
  await requireAdmin();
  await prisma.officerRate.delete({ where: { id } });
  revalidatePath("/admin/officer-rates");
  return { ok: true };
}
