"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";

/**
 * Admin-side flow for issuing / rotating a partner's portal login.
 *
 * One PARTNER User per partner organisation today (Q1 = shared login).
 * Calling this with the partner's existing email updates the password;
 * a different email creates a new User and inactivates the old one so
 * the JWT/session of any stale browser becomes useless.
 *
 * Email uniqueness is enforced at the DB level (User.email is unique
 * citext) — we surface that as a friendly fieldError rather than a
 * raw P2002.
 */

export type PartnerLoginState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /// One-shot success message ("Login created" / "Password updated").
  success?: string;
};

const Input = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z
    .string()
    .min(0)
    .max(200)
    .optional()
    .nullable(),
  name: z.string().trim().max(120).optional().nullable(),
});

export async function upsertPartnerLogin(
  partnerId: string,
  _prev: PartnerLoginState,
  formData: FormData,
): Promise<PartnerLoginState> {
  await requireAdmin();

  const parsed = Input.safeParse({
    email: formData.get("email")?.toString() ?? "",
    password: formData.get("password")?.toString() || null,
    name: formData.get("name")?.toString() || null,
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const { email, password, name } = parsed.data;

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, name: true },
  });
  if (!partner) return { error: "Partner not found." };

  // Anyone already in the User table with this email — could be our
  // staff, another partner's seat, or this same partner's existing seat.
  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, partnerId: true },
  });

  // If the email is taken by someone other than this partner, reject.
  if (
    existingByEmail &&
    !(existingByEmail.role === "PARTNER" && existingByEmail.partnerId === partnerId)
  ) {
    return {
      error: "That email is already in use by another account.",
      fieldErrors: { email: ["Already in use"] },
    };
  }

  // Existing seat for this partner (different email) — find by partnerId
  // + role so we can deactivate it on email change.
  const existingForPartner = await prisma.user.findFirst({
    where: { partnerId, role: "PARTNER" },
    select: { id: true, email: true, active: true },
  });

  if (existingByEmail) {
    // Same email, same partner → update name/password in place.
    if (password && password.length > 0) {
      if (password.length < 8) {
        return {
          error: "Please fix the errors below.",
          fieldErrors: { password: ["At least 8 characters"] },
        };
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          passwordHash,
          name: name || partner.name,
          active: true,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { name: name || partner.name, active: true },
      });
    }
    revalidatePath(`/admin/partners/${partnerId}/edit`);
    return { success: "Login updated." };
  }

  // New email path — must include a password.
  if (!password || password.length < 8) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: {
        password: [password ? "At least 8 characters" : "Required for new login"],
      },
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      name: name || partner.name,
      role: "PARTNER",
      partnerId,
      passwordHash,
      active: true,
    },
  });

  // Deactivate the old seat so stale browser sessions on the previous
  // email stop working — they'll be re-issued on next sign-in but the
  // login is rejected since active=false.
  if (existingForPartner && existingForPartner.email !== email) {
    await prisma.user.update({
      where: { id: existingForPartner.id },
      data: { active: false },
    });
  }

  revalidatePath(`/admin/partners/${partnerId}/edit`);
  return { success: "Login created. Share the credentials with the partner." };
}

export async function deactivatePartnerLogin(
  partnerId: string,
): Promise<{ ok: true }> {
  await requireAdmin();
  await prisma.user.updateMany({
    where: { partnerId, role: "PARTNER" },
    data: { active: false },
  });
  revalidatePath(`/admin/partners/${partnerId}/edit`);
  return { ok: true };
}
