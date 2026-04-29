"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const SITE_TYPES = [
  "COMMERCIAL",
  "RESIDENTIAL",
  "RETAIL",
  "STORAGE",
  "INDUSTRIAL",
  "OTHER",
] as const;

const SERVICE_TAGS = [
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

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const SiteInput = z.object({
  code: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(1, "Name is required").max(200),
  addressLine: z.string().trim().min(1, "Address is required").max(300),
  postcode: z.string().trim().min(2, "Postcode is required").max(12),
  city: z.string().trim().max(80).optional().nullable(),
  type: z.enum(SITE_TYPES),
  regionId: z.coerce.number().int().positive().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  partnerId: z.string().uuid().optional().nullable(),
  services: z.array(z.enum(SERVICE_TAGS)).default([]),
  riskLevel: z.enum(RISK_LEVELS).default("LOW"),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().default(true),
});

export type SiteFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function normalisePostcode(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(pc: string): string {
  const n = normalisePostcode(pc);
  if (n.length < 5) return pc.toUpperCase().trim();
  return `${n.slice(0, n.length - 3)} ${n.slice(-3)}`;
}

function parseFormData(formData: FormData) {
  const services = formData.getAll("services").map(String);
  const raw = {
    code: formData.get("code")?.toString() || null,
    name: formData.get("name")?.toString() ?? "",
    addressLine: formData.get("addressLine")?.toString() ?? "",
    postcode: formData.get("postcode")?.toString() ?? "",
    city: formData.get("city")?.toString() || null,
    type: formData.get("type")?.toString() ?? "COMMERCIAL",
    regionId: formData.get("regionId")?.toString() || null,
    customerId: formData.get("customerId")?.toString() || null,
    partnerId: formData.get("partnerId")?.toString() || null,
    services,
    riskLevel: formData.get("riskLevel")?.toString() ?? "LOW",
    notes: formData.get("notes")?.toString() || null,
    active: formData.get("active") === "on",
  };
  return SiteInput.safeParse(raw);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    throw new Error("Not authorised");
  }
}

export async function createSite(
  _prev: SiteFormState,
  formData: FormData,
): Promise<SiteFormState> {
  await requireAdmin();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  if (d.code) {
    const dup = await prisma.site.findUnique({ where: { code: d.code } });
    if (dup) {
      return {
        error: "A site with this code already exists.",
        fieldErrors: { code: ["Code must be unique"] },
      };
    }
  }

  const created = await prisma.site.create({
    data: {
      code: d.code || null,
      name: d.name,
      addressLine: d.addressLine,
      postcode: normalisePostcode(d.postcode),
      postcodeFormatted: formatPostcode(d.postcode),
      city: d.city || null,
      type: d.type as any,
      regionId: d.regionId ?? null,
      customerId: d.customerId || null,
      partnerId: d.partnerId || null,
      services: d.services as any,
      riskLevel: d.riskLevel as any,
      notes: d.notes || null,
      active: d.active,
    },
    select: { id: true },
  });

  revalidatePath("/sites");
  redirect(`/sites/${created.id}`);
}

export async function updateSite(
  id: string,
  _prev: SiteFormState,
  formData: FormData,
): Promise<SiteFormState> {
  await requireAdmin();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  if (d.code) {
    const dup = await prisma.site.findFirst({
      where: { code: d.code, NOT: { id } },
      select: { id: true },
    });
    if (dup) {
      return {
        error: "A different site already uses this code.",
        fieldErrors: { code: ["Code must be unique"] },
      };
    }
  }

  await prisma.site.update({
    where: { id },
    data: {
      code: d.code || null,
      name: d.name,
      addressLine: d.addressLine,
      postcode: normalisePostcode(d.postcode),
      postcodeFormatted: formatPostcode(d.postcode),
      city: d.city || null,
      type: d.type as any,
      regionId: d.regionId ?? null,
      customerId: d.customerId || null,
      partnerId: d.partnerId || null,
      services: d.services as any,
      riskLevel: d.riskLevel as any,
      notes: d.notes || null,
      active: d.active,
    },
  });

  revalidatePath("/sites");
  revalidatePath(`/sites/${id}`);
  redirect(`/sites/${id}`);
}

const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  customerId: z.string().uuid().nullable().optional(),
  partnerId: z.string().uuid().nullable().optional(),
  regionId: z.coerce.number().int().positive().nullable().optional(),
});

export type BulkUpdateResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function bulkUpdateSites(input: {
  ids: string[];
  customerId: string | null | undefined;
  partnerId: string | null | undefined;
  regionId: number | null | undefined;
}): Promise<BulkUpdateResult> {
  await requireAdmin();
  const parsed = BulkInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid selection." };
  }
  const { ids, customerId, partnerId, regionId } = parsed.data;

  const data: {
    customerId?: string | null;
    partnerId?: string | null;
    regionId?: number | null;
  } = {};
  if (customerId !== undefined) data.customerId = customerId;
  if (partnerId !== undefined) data.partnerId = partnerId;
  if (regionId !== undefined) data.regionId = regionId;

  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Nothing to change." };
  }

  const res = await prisma.site.updateMany({
    where: { id: { in: ids } },
    data,
  });

  revalidatePath("/sites");
  return { ok: true, count: res.count };
}
