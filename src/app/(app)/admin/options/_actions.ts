"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  JOB_SOURCE_CODES,
  JOB_TYPE_CODES,
  type JobSourceCode,
  type JobTypeCode,
} from "@/lib/labels";

/**
 * CRUD for the JobTypeOption / JobSourceOption lookup tables.
 *
 * Admins can:
 *   - rename labels (the picker + display label flips immediately),
 *   - hide options (active=false hides from pickers, leaves existing
 *     Jobs untouched),
 *   - reorder via sortOrder (lower = earlier),
 *   - add a new label for an existing enum code (alias).
 *
 * The underlying enum is unchanged — you cannot add a genuinely new
 * category here, only new labels. Adding "Spot check" as a JobType
 * option means the picker shows "Spot check"; the Job.type column
 * still stores the original enum code.
 *
 * Delete is allowed but if no active option remains for a code, that
 * code disappears from the picker. Existing Jobs with that code keep
 * a fallback humanised label via getJobTypeLabels.
 */

type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

const TypeInput = z.object({
  code: z.enum(JOB_TYPE_CODES as readonly [string, ...string[]]),
  label: z.string().trim().min(1, "Label is required").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  active: z.coerce.boolean().default(true),
});

const SourceInput = z.object({
  code: z.enum(JOB_SOURCE_CODES as readonly [string, ...string[]]),
  label: z.string().trim().min(1, "Label is required").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  active: z.coerce.boolean().default(true),
});

function parseTypeForm(formData: FormData) {
  return TypeInput.safeParse({
    code: formData.get("code")?.toString() ?? "",
    label: formData.get("label")?.toString() ?? "",
    description: formData.get("description")?.toString() || null,
    sortOrder: formData.get("sortOrder")?.toString() ?? "100",
    active: formData.get("active") === "on",
  });
}

function parseSourceForm(formData: FormData) {
  return SourceInput.safeParse({
    code: formData.get("code")?.toString() ?? "",
    label: formData.get("label")?.toString() ?? "",
    description: formData.get("description")?.toString() || null,
    sortOrder: formData.get("sortOrder")?.toString() ?? "100",
    active: formData.get("active") === "on",
  });
}

function flattenIssues(err: z.ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

function revalidate() {
  revalidatePath("/admin/options");
  revalidatePath("/dispatch");
  revalidatePath("/dispatch/callouts/new");
  revalidatePath("/dispatch/new");
  revalidatePath("/jobs");
}

export async function createJobTypeOption(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const parsed = parseTypeForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: flattenIssues(parsed.error) };
  }
  await prisma.jobTypeOption.create({
    data: { ...parsed.data, code: parsed.data.code as JobTypeCode as any },
  });
  revalidate();
  return {};
}

export async function updateJobTypeOption(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const parsed = parseTypeForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: flattenIssues(parsed.error) };
  }
  await prisma.jobTypeOption.update({
    where: { id },
    data: { ...parsed.data, code: parsed.data.code as JobTypeCode as any },
  });
  revalidate();
  return {};
}

export async function deleteJobTypeOption(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await prisma.jobTypeOption.delete({ where: { id } });
  revalidate();
  return { ok: true };
}

export async function toggleJobTypeOptionActive(id: string): Promise<void> {
  await requireAdmin();
  const row = await prisma.jobTypeOption.findUnique({
    where: { id },
    select: { active: true },
  });
  if (!row) return;
  await prisma.jobTypeOption.update({
    where: { id },
    data: { active: !row.active },
  });
  revalidate();
}

export async function createJobSourceOption(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const parsed = parseSourceForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: flattenIssues(parsed.error) };
  }
  await prisma.jobSourceOption.create({
    data: { ...parsed.data, code: parsed.data.code as JobSourceCode as any },
  });
  revalidate();
  return {};
}

export async function updateJobSourceOption(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const parsed = parseSourceForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: flattenIssues(parsed.error) };
  }
  await prisma.jobSourceOption.update({
    where: { id },
    data: { ...parsed.data, code: parsed.data.code as JobSourceCode as any },
  });
  revalidate();
  return {};
}

export async function deleteJobSourceOption(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await prisma.jobSourceOption.delete({ where: { id } });
  revalidate();
  return { ok: true };
}

export async function toggleJobSourceOptionActive(id: string): Promise<void> {
  await requireAdmin();
  const row = await prisma.jobSourceOption.findUnique({
    where: { id },
    select: { active: true },
  });
  if (!row) return;
  await prisma.jobSourceOption.update({
    where: { id },
    data: { active: !row.active },
  });
  revalidate();
}
