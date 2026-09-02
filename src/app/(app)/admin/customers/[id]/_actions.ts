"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";

/**
 * Admin-side flow for issuing / rotating a customer's client-portal login.
 *
 * One CUSTOMER User per customer today (a shared read-only login). Calling
 * this with the customer's existing email updates the password; a different
 * email creates a new User and inactivates the old one so any stale
 * JWT/session becomes useless.
 *
 * Email uniqueness is enforced at the DB level (User.email is unique citext) —
 * surfaced as a friendly fieldError rather than a raw P2002.
 */

export type CustomerLoginState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

const Input = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(0).max(200).optional().nullable(),
  name: z.string().trim().max(120).optional().nullable(),
});

export async function upsertCustomerLogin(
  customerId: string,
  _prev: CustomerLoginState,
  formData: FormData,
): Promise<CustomerLoginState> {
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

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true },
  });
  if (!customer) return { error: "Customer not found." };

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, customerId: true },
  });

  // Reject if the email belongs to anyone other than this customer's seat.
  if (
    existingByEmail &&
    !(existingByEmail.role === "CUSTOMER" && existingByEmail.customerId === customerId)
  ) {
    return {
      error: "That email is already in use by another account.",
      fieldErrors: { email: ["Already in use"] },
    };
  }

  const existingForCustomer = await prisma.user.findFirst({
    where: { customerId, role: "CUSTOMER" },
    select: { id: true, email: true, active: true },
  });

  if (existingByEmail) {
    // Same email, same customer → update name/password in place.
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
        data: { passwordHash, name: name || customer.name, active: true },
      });
    } else {
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { name: name || customer.name, active: true },
      });
    }
    revalidatePath(`/admin/customers/${customerId}/edit`);
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
      name: name || customer.name,
      role: "CUSTOMER",
      customerId,
      passwordHash,
      active: true,
    },
  });

  // Deactivate the old seat on an email change so stale sessions stop working.
  if (existingForCustomer && existingForCustomer.email !== email) {
    await prisma.user.update({
      where: { id: existingForCustomer.id },
      data: { active: false },
    });
  }

  revalidatePath(`/admin/customers/${customerId}/edit`);
  return { success: "Login created. Share the credentials with the client." };
}

export async function deactivateCustomerLogin(
  customerId: string,
): Promise<{ ok: true }> {
  await requireAdmin();
  await prisma.user.updateMany({
    where: { customerId, role: "CUSTOMER" },
    data: { active: false },
  });
  revalidatePath(`/admin/customers/${customerId}/edit`);
  return { ok: true };
}
