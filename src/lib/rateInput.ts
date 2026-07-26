/**
 * Shared validation + data-shaping for the customer / site rate editors.
 * Pure (no Prisma queries, no auth) so the actions in each scope wrap it.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { RATE_SERVICES, RATE_UNITS } from "@/lib/rateMeta";

export const RateCardInput = z.object({
  service: z.enum(RATE_SERVICES),
  amount: z.coerce.number().min(0).max(1_000_000),
  unit: z.enum(RATE_UNITS),
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

export function parseRateForm(formData: FormData) {
  return RateCardInput.safeParse({
    service: formData.get("service")?.toString() ?? "ALARM_RESPONSE",
    amount: formData.get("amount")?.toString() ?? "",
    unit: formData.get("unit")?.toString() ?? "PER_VISIT",
    currency: (formData.get("currency")?.toString() ?? "GBP").toUpperCase(),
    includedMinutes: formData.get("includedMinutes")?.toString() ?? "",
    excessRatePerMin: formData.get("excessRatePerMin")?.toString() ?? "",
    notes: formData.get("notes")?.toString() || null,
  });
}

/** Turn validated input into the columns shared by SiteRate / CustomerRate. */
export function rateData(d: z.infer<typeof RateCardInput>) {
  return {
    service: d.service as any,
    amount: new Prisma.Decimal(d.amount),
    currency: d.currency,
    unit: d.unit as any,
    includedMinutes: d.includedMinutes ?? null,
    excessRatePerMin:
      d.excessRatePerMin != null ? new Prisma.Decimal(d.excessRatePerMin) : null,
    notes: d.notes ?? null,
  };
}
