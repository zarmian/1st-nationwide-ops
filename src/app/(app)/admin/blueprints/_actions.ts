"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { FieldsArraySchema } from "@/lib/formTemplates";

const JOB_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "VPI",
  "ADHOC",
] as const;

const BlueprintInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(80)
    .regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, numbers, hyphens"),
  description: z.string().trim().max(500).optional().nullable(),
  jobType: z.enum(JOB_TYPES).nullable(),
  source: z.string().trim().max(120).optional().nullable(),
  fields: FieldsArraySchema,
  active: z.boolean().default(true),
});

export type BlueprintFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};


function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseForm(formData: FormData) {
  const jobTypeRaw = formData.get("jobType")?.toString() ?? "";
  const raw = {
    name: formData.get("name")?.toString() ?? "",
    slug: (formData.get("slug")?.toString() ?? "").trim().toLowerCase(),
    description: formData.get("description")?.toString() || null,
    jobType: jobTypeRaw === "" ? null : jobTypeRaw,
    source: formData.get("source")?.toString() || null,
    fields: safeJson(formData.get("fields_json")?.toString(), [] as unknown[]),
    active: formData.get("active") === "on",
  };
  return BlueprintInput.safeParse(raw);
}

export async function createBlueprint(
  _prev: BlueprintFormState,
  formData: FormData,
): Promise<BlueprintFormState> {
  const me = await requireAdmin();
  const userId = me.id;
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  // Slug uniqueness — surface a clean error rather than a Prisma constraint dump.
  const clash = await prisma.formBlueprint.findUnique({
    where: { slug: d.slug },
    select: { id: true },
  });
  if (clash) {
    return {
      error: "A blueprint with that slug already exists.",
      fieldErrors: { slug: ["Slug must be unique"] },
    };
  }
  const created = await prisma.formBlueprint.create({
    data: {
      slug: d.slug,
      name: d.name,
      description: d.description,
      jobType: d.jobType as any,
      source: d.source,
      fields: d.fields as any,
      active: d.active,
      builtin: false,
      createdById: userId ?? null,
    },
    select: { id: true },
  });
  revalidatePath("/admin/blueprints");
  redirect(`/admin/blueprints/${created.id}/edit`);
}

export async function updateBlueprint(
  id: string,
  _prev: BlueprintFormState,
  formData: FormData,
): Promise<BlueprintFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const existing = await prisma.formBlueprint.findUnique({
    where: { id },
    select: { slug: true, builtin: true },
  });
  if (!existing) {
    return { error: "Blueprint not found." };
  }
  if (d.slug !== existing.slug) {
    const clash = await prisma.formBlueprint.findUnique({
      where: { slug: d.slug },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      return {
        error: "A blueprint with that slug already exists.",
        fieldErrors: { slug: ["Slug must be unique"] },
      };
    }
  }
  await prisma.formBlueprint.update({
    where: { id },
    data: {
      slug: d.slug,
      name: d.name,
      description: d.description,
      jobType: d.jobType as any,
      source: d.source,
      fields: d.fields as any,
      active: d.active,
    },
  });
  revalidatePath("/admin/blueprints");
  revalidatePath(`/admin/blueprints/${id}/edit`);
  redirect("/admin/blueprints");
}

export async function deleteBlueprint(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const bp = await prisma.formBlueprint.findUnique({
    where: { id },
    select: { builtin: true, _count: { select: { templates: true } } },
  });
  if (!bp) return { ok: false, error: "Blueprint not found" };
  if (bp.builtin) {
    // Don't delete builtins — deactivate instead so they disappear from pickers
    // but stay around for any FormTemplates that already point at them.
    await prisma.formBlueprint.update({
      where: { id },
      data: { active: false },
    });
    revalidatePath("/admin/blueprints");
    return { ok: true };
  }
  if (bp._count.templates > 0) {
    await prisma.formBlueprint.update({
      where: { id },
      data: { active: false },
    });
    revalidatePath("/admin/blueprints");
    return { ok: true };
  }
  await prisma.formBlueprint.delete({ where: { id } });
  revalidatePath("/admin/blueprints");
  return { ok: true };
}
