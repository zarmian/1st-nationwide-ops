"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
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

/**
 * Issue / rotate the officer's mobile login. One PARTNER_OFFICER User
 * row per PartnerOfficer (1:1 via PartnerOfficer.userId). The email
 * uniqueness is enforced at the DB; we surface that as a friendly
 * fieldError. Empty password on an existing seat means "keep current
 * password" — partner-admin only changes the email.
 *
 * Same pattern as upsertPartnerLogin on the admin side.
 */
export type OfficerLoginState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(0).max(200).optional().nullable(),
});

export async function upsertPartnerOfficerLogin(
  officerId: string,
  _prev: OfficerLoginState,
  formData: FormData,
): Promise<OfficerLoginState> {
  const me = await requirePartner();
  const parsed = LoginInput.safeParse({
    email: formData.get("email")?.toString() ?? "",
    password: formData.get("password")?.toString() || null,
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { email, password } = parsed.data;

  // Confirm the officer belongs to this partner.
  const officer = await prisma.partnerOfficer.findFirst({
    where: { id: officerId, partnerId: me.partnerId },
    select: { id: true, name: true, userId: true },
  });
  if (!officer) return { error: "Officer not found." };

  // Email already in use?
  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, partnerId: true },
  });
  const isOwnSeat =
    existingByEmail?.role === "PARTNER_OFFICER" &&
    existingByEmail?.id === officer.userId;
  if (existingByEmail && !isOwnSeat) {
    return {
      error: "That email is already in use by another account.",
      fieldErrors: { email: ["Already in use"] },
    };
  }

  if (isOwnSeat) {
    // Update name/password in place on the existing User row.
    if (password && password.length > 0) {
      if (password.length < 8) {
        return {
          error: "Please fix the errors below.",
          fieldErrors: { password: ["At least 8 characters"] },
        };
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: existingByEmail!.id },
        data: { passwordHash, name: officer.name, active: true },
      });
    } else {
      await prisma.user.update({
        where: { id: existingByEmail!.id },
        data: { name: officer.name, active: true },
      });
    }
    revalidatePath(`/partner/officers/${officerId}/edit`);
    return { success: "Login updated." };
  }

  // No existing seat with this email → must include a password.
  if (!password || password.length < 8) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: {
        password: [password ? "At least 8 characters" : "Required for new login"],
      },
    };
  }
  const passwordHash = await bcrypt.hash(password, 10);

  // Deactivate the previous login if one existed under a different
  // email — stops a stale browser session from working.
  if (officer.userId) {
    await prisma.user.update({
      where: { id: officer.userId },
      data: { active: false },
    });
  }

  const newUser = await prisma.user.create({
    data: {
      email,
      name: officer.name,
      role: "PARTNER_OFFICER",
      partnerId: me.partnerId,
      passwordHash,
      active: true,
    },
    select: { id: true },
  });
  await prisma.partnerOfficer.update({
    where: { id: officer.id },
    data: { userId: newUser.id },
  });
  revalidatePath(`/partner/officers/${officerId}/edit`);
  return { success: "Login created. Share the credentials with the officer." };
}

export async function deactivatePartnerOfficerLogin(
  officerId: string,
): Promise<{ ok: boolean }> {
  const me = await requirePartner();
  const officer = await prisma.partnerOfficer.findFirst({
    where: { id: officerId, partnerId: me.partnerId },
    select: { userId: true },
  });
  if (officer?.userId) {
    await prisma.user.update({
      where: { id: officer.userId },
      data: { active: false },
    });
  }
  revalidatePath(`/partner/officers/${officerId}/edit`);
  return { ok: true };
}
