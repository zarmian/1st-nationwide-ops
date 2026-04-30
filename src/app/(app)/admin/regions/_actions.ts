"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const RegionInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type RegionFormState = {
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

function parseForm(formData: FormData) {
  return RegionInput.safeParse({
    name: formData.get("name")?.toString() ?? "",
    notes: formData.get("notes")?.toString() || null,
  });
}

export async function createRegion(
  _prev: RegionFormState,
  formData: FormData,
): Promise<RegionFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const dup = await prisma.region.findUnique({
    where: { name: parsed.data.name },
  });
  if (dup) {
    return {
      error: "A region with this name already exists.",
      fieldErrors: { name: ["Must be unique"] },
    };
  }
  await prisma.region.create({
    data: {
      name: parsed.data.name,
      notes: parsed.data.notes ?? null,
    },
  });
  revalidatePath("/admin/regions");
  return {};
}

export async function updateRegion(
  id: number,
  _prev: RegionFormState,
  formData: FormData,
): Promise<RegionFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const dup = await prisma.region.findFirst({
    where: { name: parsed.data.name, NOT: { id } },
    select: { id: true },
  });
  if (dup) {
    return {
      error: "Another region already uses this name.",
      fieldErrors: { name: ["Must be unique"] },
    };
  }
  await prisma.region.update({
    where: { id },
    data: {
      name: parsed.data.name,
      notes: parsed.data.notes ?? null,
    },
  });
  revalidatePath("/admin/regions");
  return {};
}

export async function deleteRegion(id: number): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const inUse = await prisma.site.count({ where: { regionId: id } });
  if (inUse > 0) {
    return {
      ok: false,
      error: `Can't delete — ${inUse} site${inUse === 1 ? " is" : "s are"} in this region.`,
    };
  }
  await prisma.region.delete({ where: { id } });
  revalidatePath("/admin/regions");
  return { ok: true };
}
