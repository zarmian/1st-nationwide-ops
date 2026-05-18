"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  previewSitesImport,
  runSitesImport,
  type SitesImportPreview,
  type SitesImportResult,
} from "@/lib/sitesImport";

export type SitesPreviewActionResult =
  | ({ ok: true } & SitesImportPreview)
  | { ok: false; error: string };

export async function previewSites(
  formData: FormData,
): Promise<SitesPreviewActionResult> {
  await requireAdmin();
  const file = formData.get("csv") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  const text = await file.text();
  try {
    const result = await previewSitesImport(prisma, text);
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Preview failed" };
  }
}

export type SitesCommitActionResult =
  | ({ ok: true } & SitesImportResult)
  | { ok: false; error: string };

export async function commitSites(
  formData: FormData,
): Promise<SitesCommitActionResult> {
  await requireAdmin();
  const file = formData.get("csv") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  const text = await file.text();
  try {
    const result = await runSitesImport(prisma, text);
    revalidatePath("/sites");
    revalidatePath("/dispatch");
    revalidatePath("/admin/imports/sites");
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Import failed" };
  }
}
