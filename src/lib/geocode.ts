/**
 * UK postcode geocoding via postcodes.io (free, no auth, generous limits).
 *
 * Used to backfill Site.lat / Site.lng so the dispatch map can show site
 * markers for sites whose CSVs only carry a postcode.
 */
import type { PrismaClient } from "@prisma/client";

type BulkResultRow = {
  query: string;
  result: { latitude: number; longitude: number } | null;
};

const ENDPOINT = "https://api.postcodes.io/postcodes";
const BATCH_SIZE = 100; // postcodes.io max per bulk POST

/**
 * Look up a list of postcodes. Returns a Map keyed by the *exact string* you
 * passed in (so the caller controls casing/spacing). Postcodes that don't
 * resolve are simply omitted from the result map.
 */
export async function geocodePostcodes(
  postcodes: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  // dedupe to keep the request small
  const unique = Array.from(new Set(postcodes.filter((p) => p && p.length > 0)));
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    let json: { result?: BulkResultRow[] } | null = null;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes: batch }),
        cache: "no-store",
      });
      if (!res.ok) continue;
      json = (await res.json()) as { result?: BulkResultRow[] };
    } catch {
      continue;
    }
    for (const row of json?.result ?? []) {
      if (!row.result) continue;
      const { latitude, longitude } = row.result;
      if (
        typeof latitude === "number" &&
        typeof longitude === "number" &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude)
      ) {
        out.set(row.query, { lat: latitude, lng: longitude });
      }
    }
  }
  return out;
}

export type GeocodeBackfillResult = {
  scanned: number;
  geocoded: number;
  failed: number;
};

/**
 * Find every Site that has a postcode but is missing lat/lng, look them up,
 * and write coordinates back. Safe to re-run — only touches rows where coords
 * are still null. Returns counts for the caller to surface in the UI.
 */
export async function geocodeSitesMissingCoords(
  prisma: PrismaClient,
): Promise<GeocodeBackfillResult> {
  const sites = await prisma.site.findMany({
    where: {
      OR: [{ lat: null }, { lng: null }],
      postcode: { not: "" },
    },
    select: { id: true, postcode: true },
  });
  if (sites.length === 0) return { scanned: 0, geocoded: 0, failed: 0 };

  const coords = await geocodePostcodes(sites.map((s) => s.postcode));
  let geocoded = 0;
  let failed = 0;
  for (const s of sites) {
    const c = coords.get(s.postcode);
    if (!c) {
      failed++;
      continue;
    }
    await prisma.site.update({
      where: { id: s.id },
      data: { lat: c.lat, lng: c.lng },
    });
    geocoded++;
  }
  return { scanned: sites.length, geocoded, failed };
}
