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
import {
  geocodeSitesMissingCoords,
  type GeocodeBackfillResult,
} from "@/lib/geocode";

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

export async function countSitesMissingCoords(): Promise<number> {
  await requireAdmin();
  return prisma.site.count({
    where: {
      OR: [{ lat: null }, { lng: null }],
      postcode: { not: "" },
    },
  });
}

export async function countSitesWithPostcode(): Promise<number> {
  await requireAdmin();
  return prisma.site.count({
    where: { postcode: { not: "" } },
  });
}

export type GeocodeActionResult =
  | ({ ok: true } & GeocodeBackfillResult)
  | { ok: false; error: string };

export async function geocodeMissingSites(): Promise<GeocodeActionResult> {
  await requireAdmin();
  try {
    const result = await geocodeSitesMissingCoords(prisma);
    revalidatePath("/dispatch");
    revalidatePath("/sites");
    revalidatePath("/admin/imports/sites");
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Geocoding failed" };
  }
}

/**
 * Force-refresh lat/lng on every site with a postcode, even ones that
 * already have coordinates. Use when an earlier import wrote wrong values.
 */
export async function regeocodeAllSites(): Promise<GeocodeActionResult> {
  await requireAdmin();
  try {
    const result = await geocodeSitesMissingCoords(prisma, { force: true });
    revalidatePath("/dispatch");
    revalidatePath("/sites");
    revalidatePath("/admin/imports/sites");
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Geocoding failed" };
  }
}

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
