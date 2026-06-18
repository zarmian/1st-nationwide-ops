"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";

/**
 * Partner-officer CRUD.
 *
 * Every action calls requirePartner() and scopes by the SESSION's
 * partnerId — never the request body. A partner can only create /
 * update / deactivate their own roster.
 */

export type OfficerFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

const Input = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  siaNumber: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  active: z.boolean().default(true),
});

function parseForm(formData: FormData) {
  return Input.safeParse({
    name: formData.get("name")?.toString() ?? "",
    phone: formData.get("phone")?.toString() || null,
    siaNumber: formData.get("siaNumber")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
    active: formData.get("active") === "on",
  });
}

function flatten(err: z.ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

export async function createPartnerOfficer(
  _prev: OfficerFormState,
  formData: FormData,
): Promise<OfficerFormState> {
  const me = await requirePartner();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: flatten(parsed.error),
    };
  }
  const created = await prisma.partnerOfficer.create({
    data: { ...parsed.data, partnerId: me.partnerId },
    select: { id: true },
  });
  revalidatePath("/partner/officers");
  revalidatePath("/partner");
  redirect(`/partner/officers/${created.id}/edit`);
}

export async function updatePartnerOfficer(
  id: string,
  _prev: OfficerFormState,
  formData: FormData,
): Promise<OfficerFormState> {
  const me = await requirePartner();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: flatten(parsed.error),
    };
  }
  // Belongs-to-me check: an UPDATE with two WHERE conditions returns 0
  // affected rows if the row is someone else's, but Prisma throws on
  // findUnique-then-update. Use a single updateMany so cross-tenant
  // attempts silently no-op rather than raise.
  const result = await prisma.partnerOfficer.updateMany({
    where: { id, partnerId: me.partnerId },
    data: parsed.data,
  });
  if (result.count === 0) {
    return { error: "Officer not found." };
  }
  revalidatePath("/partner/officers");
  revalidatePath(`/partner/officers/${id}/edit`);
  return {};
}

export async function setPartnerOfficerActive(
  id: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  const me = await requirePartner();
  await prisma.partnerOfficer.updateMany({
    where: { id, partnerId: me.partnerId },
    data: { active },
  });
  revalidatePath("/partner/officers");
  return { ok: true };
}
