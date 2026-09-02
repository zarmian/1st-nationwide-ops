"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAdmin, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { normaliseE164 } from "@/lib/whatsapp";
import { parseIsoDate } from "@/lib/dates";

const ROLES = ["OFFICER", "DISPATCHER", "ADMIN"] as const;

const OfficerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Valid email required").max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsappNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => (v ? normaliseE164(v) : null))
    .refine((v) => v === null || v.startsWith("+"), {
      message: "Use a UK mobile (07…) or full international (+44…)",
    }),
  siaNumber: z.string().trim().max(40).optional().nullable(),
  siaExpiry: z.date().nullable().optional(),
  rightToWorkExpiry: z.date().nullable().optional(),
  dbsCheckedOn: z.date().nullable().optional(),
  regionId: z.coerce.number().int().positive().optional().nullable(),
  role: z.enum(ROLES).default("OFFICER"),
  active: z.boolean().default(true),
  password: z.string().min(8, "Min 8 characters").max(120).optional().nullable(),
});

export type OfficerFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};


function parseForm(formData: FormData) {
  const regionRaw = formData.get("regionId")?.toString() ?? "";
  const raw = {
    name: formData.get("name")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    phone: formData.get("phone")?.toString() || null,
    whatsappNumber: formData.get("whatsappNumber")?.toString() || null,
    siaNumber: formData.get("siaNumber")?.toString() || null,
    siaExpiry: parseIsoDate(formData.get("siaExpiry")?.toString() || ""),
    rightToWorkExpiry: parseIsoDate(
      formData.get("rightToWorkExpiry")?.toString() || "",
    ),
    dbsCheckedOn: parseIsoDate(formData.get("dbsCheckedOn")?.toString() || ""),
    regionId: regionRaw === "" ? null : regionRaw,
    role: formData.get("role")?.toString() ?? "OFFICER",
    active: formData.get("active") === "on",
    password: formData.get("password")?.toString() || null,
  };
  return OfficerInput.safeParse(raw);
}

export async function createOfficer(
  _prev: OfficerFormState,
  formData: FormData,
): Promise<OfficerFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  if (!d.password) {
    return {
      error: "Set an initial password — share it with the officer.",
      fieldErrors: { password: ["Required when creating"] },
    };
  }
  const emailClash = await prisma.user.findUnique({
    where: { email: d.email },
    select: { id: true },
  });
  if (emailClash) {
    return {
      error: "An account with that email already exists.",
      fieldErrors: { email: ["Email must be unique"] },
    };
  }
  if (d.siaNumber) {
    const siaClash = await prisma.user.findUnique({
      where: { siaNumber: d.siaNumber },
      select: { id: true },
    });
    if (siaClash) {
      return {
        error: "An officer with that SIA number already exists.",
        fieldErrors: { siaNumber: ["SIA number must be unique"] },
      };
    }
  }
  const passwordHash = await bcrypt.hash(d.password, 10);
  const created = await prisma.user.create({
    data: {
      name: d.name,
      email: d.email,
      phone: d.phone,
      whatsappNumber: d.whatsappNumber,
      siaNumber: d.siaNumber,
      siaExpiry: d.siaExpiry ?? null,
      rightToWorkExpiry: d.rightToWorkExpiry ?? null,
      dbsCheckedOn: d.dbsCheckedOn ?? null,
      regionId: d.regionId,
      role: d.role as any,
      active: d.active,
      passwordHash,
    },
    select: { id: true },
  });
  revalidatePath("/officers");
  redirect(`/officers/${created.id}/edit`);
}

export async function updateOfficer(
  id: string,
  _prev: OfficerFormState,
  formData: FormData,
): Promise<OfficerFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const existing = await prisma.user.findUnique({
    where: { id },
    select: { email: true, siaNumber: true },
  });
  if (!existing) {
    return { error: "Officer not found." };
  }
  if (d.email !== existing.email) {
    const clash = await prisma.user.findUnique({
      where: { email: d.email },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      return {
        error: "An account with that email already exists.",
        fieldErrors: { email: ["Email must be unique"] },
      };
    }
  }
  if (d.siaNumber && d.siaNumber !== existing.siaNumber) {
    const clash = await prisma.user.findUnique({
      where: { siaNumber: d.siaNumber },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      return {
        error: "An officer with that SIA number already exists.",
        fieldErrors: { siaNumber: ["SIA number must be unique"] },
      };
    }
  }
  const passwordHash = d.password ? await bcrypt.hash(d.password, 10) : undefined;
  await prisma.user.update({
    where: { id },
    data: {
      name: d.name,
      email: d.email,
      phone: d.phone,
      whatsappNumber: d.whatsappNumber,
      siaNumber: d.siaNumber,
      siaExpiry: d.siaExpiry ?? null,
      rightToWorkExpiry: d.rightToWorkExpiry ?? null,
      dbsCheckedOn: d.dbsCheckedOn ?? null,
      regionId: d.regionId,
      role: d.role as any,
      active: d.active,
      ...(passwordHash ? { passwordHash } : {}),
    },
  });
  revalidatePath("/officers");
  revalidatePath(`/officers/${id}/edit`);
  redirect("/officers");
}

/** Add a training certificate / qualification to an officer. */
export async function addCertificationAction(
  officerId: string,
  input: { name: string; expiresOn?: string | null; reference?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Give the certificate a name." };
  try {
    await prisma.officerCertification.create({
      data: {
        officerId,
        name,
        expiresOn: input.expiresOn ? parseIsoDate(input.expiresOn) : null,
        reference: input.reference?.trim() || null,
      },
    });
  } catch (e) {
    console.error("addCertification failed", e);
    return { ok: false, error: "Couldn't save the certificate. Please retry." };
  }
  revalidatePath(`/officers/${officerId}/edit`);
  revalidatePath("/compliance");
  return { ok: true };
}

/** Delete an officer certificate. */
export async function deleteCertificationAction(
  id: string,
  officerId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.officerCertification.delete({ where: { id } });
  } catch (e) {
    console.error("deleteCertification failed", e);
    return { ok: false, error: "Couldn't delete the certificate. Please retry." };
  }
  revalidatePath(`/officers/${officerId}/edit`);
  revalidatePath("/compliance");
  return { ok: true };
}

export async function setOnDuty(
  id: string,
  onDuty: boolean,
): Promise<{ ok: boolean }> {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { onDuty },
  });
  revalidatePath("/officers");
  return { ok: true };
}

/**
 * Officer toggles their own on-duty state. No admin role required — the
 * session user can only flip their own row.
 */
export async function setMyOnDuty(
  onDuty: boolean,
): Promise<{ ok: boolean }> {
  const me = await requireUser();
  await prisma.user.update({
    where: { id: me.id },
    data: { onDuty },
  });
  revalidatePath("/m/today");
  revalidatePath("/officers");
  revalidatePath("/dispatch");
  return { ok: true };
}
