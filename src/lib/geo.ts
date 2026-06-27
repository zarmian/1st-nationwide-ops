/**
 * Geofencing for shift duty actions.
 *
 * The officer's phone reports GPS coordinates; we compare them against the
 * site's stored lat/lng and require the officer to be within a radius
 * (default 300 m, per-site override via Site.geofenceRadiusM).
 *
 * Pure functions — no DB access — so they're trivially unit-testable and
 * can run on both the client (live distance display) and the server (the
 * authoritative block).
 */

/** App-wide default geofence radius in metres when a site has no override. */
export const DEFAULT_GEOFENCE_M = 300;

/**
 * Great-circle distance between two lat/lng points in metres (haversine).
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type GeofenceInput = {
  siteLat: number | null | undefined;
  siteLng: number | null | undefined;
  radiusM?: number | null;
  gpsLat: number;
  gpsLng: number;
};

export type GeofenceResult = {
  /** False when the site has no coordinates — we can't enforce, so callers
   *  allow the action but flag it for admin attention. */
  enforced: boolean;
  /** True when within radius, or when not enforceable (so callers don't
   *  block on a site that simply lacks coordinates). */
  withinRadius: boolean;
  /** Distance from the site in metres, or null when not enforceable. */
  distanceM: number | null;
  /** The radius applied (site override or the default). */
  radiusM: number;
};

/**
 * Evaluate whether a GPS reading falls inside a site's geofence.
 *
 * When the site has no lat/lng we cannot enforce — return enforced:false,
 * withinRadius:true so a missing-coordinate site never permanently blocks an
 * officer from starting (the record is flagged elsewhere for admins to fix).
 */
export function evaluateGeofence(input: GeofenceInput): GeofenceResult {
  const radiusM = input.radiusM ?? DEFAULT_GEOFENCE_M;
  if (
    input.siteLat == null ||
    input.siteLng == null ||
    !Number.isFinite(input.siteLat) ||
    !Number.isFinite(input.siteLng)
  ) {
    return { enforced: false, withinRadius: true, distanceM: null, radiusM };
  }
  const distanceM = haversineMeters(
    input.siteLat,
    input.siteLng,
    input.gpsLat,
    input.gpsLng,
  );
  return {
    enforced: true,
    withinRadius: distanceM <= radiusM,
    distanceM,
    radiusM,
  };
}

/** Round metres to a whole number for display / storage. */
export function roundMeters(m: number | null): number | null {
  return m == null ? null : Math.round(m);
}
