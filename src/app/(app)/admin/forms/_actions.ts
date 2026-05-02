"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FieldsArraySchema } from "@/lib/formTemplates";

const SCOPES = ["GLOBAL", "CUSTOMER", "PARTNER", "SITE"] as const;
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

const TemplateInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    jobType: z.enum(JOB_TYPES).nullable(),
    scope: z.enum(SCOPES),
    customerId: z.string().uuid().optional().nullable(),
    partnerId: z.string().uuid().optional().nullable(),
    siteId: z.string().uuid().optional().nullable(),
    fields: FieldsArraySchema,
    active: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.scope === "CUSTOMER" && !d.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "Customer is required for customer-scoped templates",
      });
    }
    if (d.scope === "PARTNER" && !d.partnerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerId"],
        message: "Partner is required for partner-scoped templates",
      });
    }
    if (d.scope === "SITE" && !d.siteId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["siteId"],
        message: "Site is required for site-scoped templates",
      });
    }
  });

export type FormTemplateState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN") {
    throw new Error("Not authorised");
  }
  return (session?.user as any)?.id as string | undefined;
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
  const scope = formData.get("scope")?.toString() ?? "GLOBAL";
  const jobTypeRaw = formData.get("jobType")?.toString() ?? "";
  const raw = {
    name: formData.get("name")?.toString() ?? "",
    jobType: jobTypeRaw === "" ? null : jobTypeRaw,
    scope,
    customerId:
      scope === "CUSTOMER"
        ? formData.get("customerId")?.toString() || null
        : null,
    partnerId:
      scope === "PARTNER"
        ? formData.get("partnerId")?.toString() || null
        : null,
    siteId:
      scope === "SITE" ? formData.get("siteId")?.toString() || null : null,
    fields: safeJson(formData.get("fields_json")?.toString(), [] as unknown[]),
    active: formData.get("active") === "on",
  };
  return TemplateInput.safeParse(raw);
}

export async function createTemplate(
  _prev: FormTemplateState,
  formData: FormData,
): Promise<FormTemplateState> {
  const userId = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const created = await prisma.formTemplate.create({
    data: {
      name: d.name,
      jobType: d.jobType as any,
      scope: d.scope as any,
      customerId: d.customerId,
      partnerId: d.partnerId,
      siteId: d.siteId,
      fields: d.fields as any,
      active: d.active,
      createdById: userId ?? null,
    },
    select: { id: true },
  });
  revalidatePath("/admin/forms");
  redirect(`/admin/forms/${created.id}/edit`);
}

export async function updateTemplate(
  id: string,
  _prev: FormTemplateState,
  formData: FormData,
): Promise<FormTemplateState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  await prisma.formTemplate.update({
    where: { id },
    data: {
      name: d.name,
      jobType: d.jobType as any,
      scope: d.scope as any,
      customerId: d.customerId,
      partnerId: d.partnerId,
      siteId: d.siteId,
      fields: d.fields as any,
      active: d.active,
    },
  });
  revalidatePath("/admin/forms");
  revalidatePath(`/admin/forms/${id}/edit`);
  redirect("/admin/forms");
}

export async function deleteTemplate(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const used = await prisma.formSubmission.count({
    where: { formTemplateId: id },
  });
  if (used > 0) {
    // Soft-delete by deactivating to preserve history.
    await prisma.formTemplate.update({
      where: { id },
      data: { active: false },
    });
    revalidatePath("/admin/forms");
    return { ok: true };
  }
  await prisma.formTemplate.delete({ where: { id } });
  revalidatePath("/admin/forms");
  return { ok: true };
}
