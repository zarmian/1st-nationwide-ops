"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const CUSTOMER_TYPES = ["CORPORATE", "RESIDENTIAL", "RESELLER"] as const;

const ContactRow = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  ref: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  remove: z.boolean().optional(),
});

const CustomerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(CUSTOMER_TYPES),
  billingAddress: z.string().trim().max(500).optional().nullable(),
  contractRef: z.string().trim().max(120).optional().nullable(),
  contractStart: z.string().trim().optional().nullable(),
  contractEnd: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().default(true),
  contacts: z.array(ContactRow).max(20).default([]),
});

export type CustomerFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN") {
    throw new Error("Not authorised");
  }
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseForm(formData: FormData) {
  const raw = {
    name: formData.get("name")?.toString() ?? "",
    type: formData.get("type")?.toString() ?? "CORPORATE",
    billingAddress: formData.get("billingAddress")?.toString() || null,
    contractRef: formData.get("contractRef")?.toString() || null,
    contractStart: formData.get("contractStart")?.toString() || null,
    contractEnd: formData.get("contractEnd")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
    active: formData.get("active") === "on",
    contacts: safeJson(formData.get("contacts_json")?.toString(), [] as unknown[]),
  };
  return CustomerInput.safeParse(raw);
}

type ParsedCustomer = z.infer<typeof CustomerInput>;

async function syncContacts(customerId: string, contacts: ParsedCustomer["contacts"]) {
  await prisma.$transaction(async (tx) => {
    for (const c of contacts) {
      if (c.id) {
        if (c.remove) {
          await tx.customerContact.delete({ where: { id: c.id } });
        } else {
          await tx.customerContact.update({
            where: { id: c.id },
            data: {
              name: c.name,
              role: c.role || null,
              email: c.email || null,
              phone: c.phone || null,
              ref: c.ref || null,
              notes: c.notes || null,
            },
          });
        }
      } else if (!c.remove) {
        await tx.customerContact.create({
          data: {
            customerId,
            name: c.name,
            role: c.role || null,
            email: c.email || null,
            phone: c.phone || null,
            ref: c.ref || null,
            notes: c.notes || null,
          },
        });
      }
    }
  });
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const dup = await prisma.customer.findUnique({ where: { name: d.name } });
  if (dup) {
    return {
      error: "A customer with this name already exists.",
      fieldErrors: { name: ["Must be unique"] },
    };
  }

  const created = await prisma.customer.create({
    data: {
      name: d.name,
      type: d.type as any,
      billingAddress: d.billingAddress || null,
      contractRef: d.contractRef || null,
      contractStart: toDate(d.contractStart),
      contractEnd: toDate(d.contractEnd),
      notes: d.notes || null,
      active: d.active,
    },
    select: { id: true },
  });
  await syncContacts(created.id, d.contacts);
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${created.id}/edit`);
}

export async function updateCustomer(
  id: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const dup = await prisma.customer.findFirst({
    where: { name: d.name, NOT: { id } },
    select: { id: true },
  });
  if (dup) {
    return {
      error: "Another customer already uses this name.",
      fieldErrors: { name: ["Must be unique"] },
    };
  }

  await prisma.customer.update({
    where: { id },
    data: {
      name: d.name,
      type: d.type as any,
      billingAddress: d.billingAddress || null,
      contractRef: d.contractRef || null,
      contractStart: toDate(d.contractStart),
      contractEnd: toDate(d.contractEnd),
      notes: d.notes || null,
      active: d.active,
    },
  });
  await syncContacts(id, d.contacts);
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${id}/edit`);
  redirect("/admin/customers");
}
