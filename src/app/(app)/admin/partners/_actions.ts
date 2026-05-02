"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const PARTNER_ROLES = ["CUSTOMER", "SUBCONTRACTOR", "BOTH"] as const;
const PARTNER_CHANNELS = [
  "EMAIL",
  "PHONE",
  "THEIR_APP",
  "WHATSAPP",
  "PORTAL",
] as const;

const ContactRow = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  remove: z.boolean().optional(),
});

const PartnerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  role: z.enum(PARTNER_ROLES),
  preferred: z.enum(PARTNER_CHANNELS).default("EMAIL"),
  emailIntake: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().default(true),
  contacts: z.array(ContactRow).max(20).default([]),
});

export type PartnerFormState = {
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

function parseForm(formData: FormData) {
  return PartnerInput.safeParse({
    name: formData.get("name")?.toString() ?? "",
    role: formData.get("role")?.toString() ?? "CUSTOMER",
    preferred: formData.get("preferred")?.toString() ?? "EMAIL",
    emailIntake: formData.get("emailIntake")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
    active: formData.get("active") === "on",
    contacts: safeJson(formData.get("contacts_json")?.toString(), [] as unknown[]),
  });
}

type ParsedPartner = z.infer<typeof PartnerInput>;

async function syncContacts(
  partnerId: string,
  contacts: ParsedPartner["contacts"],
) {
  await prisma.$transaction(async (tx) => {
    for (const c of contacts) {
      if (c.id) {
        if (c.remove) {
          await tx.partnerContact.delete({ where: { id: c.id } });
        } else {
          await tx.partnerContact.update({
            where: { id: c.id },
            data: {
              name: c.name,
              role: c.role || null,
              email: c.email || null,
              phone: c.phone || null,
              notes: c.notes || null,
            },
          });
        }
      } else if (!c.remove) {
        await tx.partnerContact.create({
          data: {
            partnerId,
            name: c.name,
            role: c.role || null,
            email: c.email || null,
            phone: c.phone || null,
            notes: c.notes || null,
          },
        });
      }
    }
  });
}

export async function createPartner(
  _prev: PartnerFormState,
  formData: FormData,
): Promise<PartnerFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const dup = await prisma.partner.findUnique({ where: { name: d.name } });
  if (dup) {
    return {
      error: "A partner with this name already exists.",
      fieldErrors: { name: ["Must be unique"] },
    };
  }
  const created = await prisma.partner.create({
    data: {
      name: d.name,
      role: d.role as any,
      preferred: d.preferred as any,
      emailIntake: d.emailIntake || null,
      notes: d.notes || null,
      active: d.active,
    },
    select: { id: true },
  });
  await syncContacts(created.id, d.contacts);
  revalidatePath("/admin/partners");
  redirect(`/admin/partners/${created.id}/edit`);
}

export async function updatePartner(
  id: string,
  _prev: PartnerFormState,
  formData: FormData,
): Promise<PartnerFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const dup = await prisma.partner.findFirst({
    where: { name: d.name, NOT: { id } },
    select: { id: true },
  });
  if (dup) {
    return {
      error: "Another partner already uses this name.",
      fieldErrors: { name: ["Must be unique"] },
    };
  }
  await prisma.partner.update({
    where: { id },
    data: {
      name: d.name,
      role: d.role as any,
      preferred: d.preferred as any,
      emailIntake: d.emailIntake || null,
      notes: d.notes || null,
      active: d.active,
    },
  });
  await syncContacts(id, d.contacts);
  revalidatePath("/admin/partners");
  revalidatePath(`/admin/partners/${id}/edit`);
  redirect("/admin/partners");
}
