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

/** "SW1A 1AA" / "sw1a1aa" → "SW1A1AA" so callers can key consistently. */
function normalise(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

/**
 * Look up a list of postcodes. Returns a Map keyed by the *normalised*
 * postcode (no spaces, uppercase) — postcodes.io can echo the query back
 * in either form, so we normalise both ends to stay safe.
 * Postcodes that don't resolve are simply omitted from the result map.
 */
export async function geocodePostcodes(
  postcodes: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const unique = Array.from(
    new Set(postcodes.filter((p) => p && p.length > 0).map(normalise)),
  );
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
        out.set(normalise(row.query), { lat: latitude, lng: longitude });
      }
    }
  }
  return out;
}

export type GeocodeFailure = {
  id: string;
  code: string | null;
  name: string;
  postcode: string;
};

export type GeocodeBackfillResult = {
  scanned: number;
  geocoded: number;
  failed: number;
  /** The sites whose postcode didn't resolve — so the admin can see
   *  exactly which sites still have no coordinates and fix them. */
  failures: GeocodeFailure[];
};

/**
 * Find every Site that has a postcode but is missing lat/lng, look them up,
 * and write coordinates back. Safe to re-run.
 *
 * Pass `{ force: true }` to re-geocode every site that has a postcode —
 * including those whose lat/lng are already set. Useful when an earlier run
 * wrote wrong values and you want to refresh from postcodes.io.
 */
export async function geocodeSitesMissingCoords(
  prisma: PrismaClient,
  opts: { force?: boolean } = {},
): Promise<GeocodeBackfillResult> {
  const sites = await prisma.site.findMany({
    where: opts.force
      ? { postcode: { not: "" } }
      : {
          OR: [{ lat: null }, { lng: null }],
          postcode: { not: "" },
        },
    select: { id: true, code: true, name: true, postcode: true },
    orderBy: [{ code: "asc" }, { name: "asc" }],
  });
  if (sites.length === 0)
    return { scanned: 0, geocoded: 0, failed: 0, failures: [] };

  const coords = await geocodePostcodes(sites.map((s) => s.postcode));
  let geocoded = 0;
  const failures: GeocodeFailure[] = [];
  for (const s of sites) {
    const c = coords.get(normalise(s.postcode));
    if (!c) {
      failures.push({
        id: s.id,
        code: s.code,
        name: s.name,
        postcode: s.postcode,
      });
      continue;
    }
    await prisma.site.update({
      where: { id: s.id },
      data: { lat: c.lat, lng: c.lng },
    });
    geocoded++;
  }
  return {
    scanned: sites.length,
    geocoded,
    failed: failures.length,
    failures,
  };
}
