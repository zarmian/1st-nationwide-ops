/**
 * Officer proof-of-presence.
 *
 * We already capture an officer's GPS fix when they attend an activity (the
 * /submit flow stamps Job/PatrolVisit lat/lng, the "on site" tap stamps a
 * visit's gpsLat/gpsLng). What was missing is the *verdict*: how far that fix
 * was from the site, and whether it fell inside the site's geofence — the
 * evidence that the officer was actually there.
 *
 * This derives that verdict from the stored coordinates + the site location
 * using the shared geo helpers (no new capture, no stored copy — the raw
 * evidence is the coordinate + timestamp already on the row).
 */
import { prisma } from "@/lib/db";
import { evaluateGeofence, roundMeters, DEFAULT_GEOFENCE_M } from "@/lib/geo";

export type ProofStatus = "within" | "outside" | "no_site_coords" | "no_fix";

export type ProofVerdict = {
  hasFix: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  locatedAt: Date | null;
  distanceM: number | null;
  /** true/false when enforceable; null when the site has no coordinates. */
  withinGeofence: boolean | null;
  enforced: boolean;
  radiusM: number;
  status: ProofStatus;
};

export function proofVerdict(input: {
  gpsLat: number | null | undefined;
  gpsLng: number | null | undefined;
  locatedAt?: Date | null;
  siteLat: number | null | undefined;
  siteLng: number | null | undefined;
  radiusM?: number | null;
}): ProofVerdict {
  const hasFix =
    input.gpsLat != null &&
    input.gpsLng != null &&
    Number.isFinite(input.gpsLat) &&
    Number.isFinite(input.gpsLng);

  if (!hasFix) {
    return {
      hasFix: false,
      gpsLat: null,
      gpsLng: null,
      locatedAt: input.locatedAt ?? null,
      distanceM: null,
      withinGeofence: null,
      enforced: false,
      radiusM: input.radiusM ?? DEFAULT_GEOFENCE_M,
      status: "no_fix",
    };
  }

  const g = evaluateGeofence({
    siteLat: input.siteLat,
    siteLng: input.siteLng,
    radiusM: input.radiusM,
    gpsLat: input.gpsLat as number,
    gpsLng: input.gpsLng as number,
  });

  return {
    hasFix: true,
    gpsLat: input.gpsLat as number,
    gpsLng: input.gpsLng as number,
    locatedAt: input.locatedAt ?? null,
    distanceM: roundMeters(g.distanceM),
    withinGeofence: g.enforced ? g.withinRadius : null,
    enforced: g.enforced,
    radiusM: g.radiusM,
    status: !g.enforced ? "no_site_coords" : g.withinRadius ? "within" : "outside",
  };
}

export const PROOF_CHIP: Record<ProofStatus, { chip: string; label: string }> = {
  within: { chip: "chip-mint", label: "On site" },
  outside: { chip: "chip-red", label: "Outside geofence" },
  no_site_coords: { chip: "chip-slate", label: "Location logged" },
  no_fix: { chip: "chip-slate", label: "No GPS captured" },
};

/** A one-line human summary, e.g. "On site · 14 m from site". */
export function proofSummary(v: ProofVerdict): string {
  if (!v.hasFix) return "No GPS captured";
  if (v.distanceM == null) return "Location logged (site has no coordinates)";
  const within = v.withinGeofence ? "on site" : "outside geofence";
  return `${within} · ${v.distanceM} m from site (target ${v.radiusM} m)`;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export type PresencePoint = {
  id: string;
  kind: string;
  href: string;
  at: Date;
  officerId: string | null;
  officerName: string | null;
  siteId: string | null;
  siteName: string | null;
  siteCode: string | null;
  gpsLat: number;
  gpsLng: number;
  siteLat: number | null;
  siteLng: number | null;
  verdict: ProofVerdict;
};

export type PresenceSummary = {
  total: number;
  enforced: number; // fixes we could check against a site geofence
  within: number;
  outside: number;
  noSiteCoords: number;
  withinPct: number | null; // within ÷ enforced
};

export function summarisePresence(points: PresencePoint[]): PresenceSummary {
  let enforced = 0;
  let within = 0;
  let outside = 0;
  let noSiteCoords = 0;
  for (const p of points) {
    if (p.verdict.status === "within") {
      enforced++;
      within++;
    } else if (p.verdict.status === "outside") {
      enforced++;
      outside++;
    } else if (p.verdict.status === "no_site_coords") {
      noSiteCoords++;
    }
  }
  return {
    total: points.length,
    enforced,
    within,
    outside,
    noSiteCoords,
    withinPct: enforced ? Math.round((within / enforced) * 100) : null,
  };
}

const JOB_KIND: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  PATROL: "Patrol",
};

/**
 * Recent attendances that carry a GPS fix — from Jobs (callouts, lock/unlocks)
 * and PatrolVisits — with their geofence verdict, newest first. Static-guarding
 * shifts have their own richer GPS+geofence record on the shift detail page, so
 * they're not duplicated here.
 */
export async function loadRecentPresence(opts: {
  days: number;
  officerId?: string | null;
  now?: Date;
}): Promise<PresencePoint[]> {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - opts.days * 86_400_000);

  const [jobs, visits] = await Promise.all([
    prisma.job.findMany({
      where: {
        lat: { not: null },
        lng: { not: null },
        locatedAt: { gte: from },
        ...(opts.officerId ? { assignedToUserId: opts.officerId } : {}),
      },
      orderBy: { locatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        type: true,
        typeLabel: true,
        lat: true,
        lng: true,
        locatedAt: true,
        assignedTo: { select: { id: true, name: true } },
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            lat: true,
            lng: true,
            geofenceRadiusM: true,
          },
        },
      },
    }),
    prisma.patrolVisit.findMany({
      where: {
        OR: [{ gpsLat: { not: null } }, { lat: { not: null } }],
        arrivedAt: { gte: from },
        ...(opts.officerId ? { officerId: opts.officerId } : {}),
      },
      orderBy: { arrivedAt: "desc" },
      take: 200,
      select: {
        id: true,
        arrivedAt: true,
        locatedAt: true,
        lat: true,
        lng: true,
        gpsLat: true,
        gpsLng: true,
        officer: { select: { id: true, name: true } },
        patrolSchedule: { select: { kind: true } },
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            lat: true,
            lng: true,
            geofenceRadiusM: true,
          },
        },
      },
    }),
  ]);

  const points: PresencePoint[] = [];

  for (const j of jobs) {
    points.push({
      id: `job:${j.id}`,
      kind: j.typeLabel ?? JOB_KIND[j.type] ?? j.type.replace(/_/g, " "),
      href: `/dispatch/${j.id}`,
      at: j.locatedAt ?? now,
      officerId: j.assignedTo?.id ?? null,
      officerName: j.assignedTo?.name ?? null,
      siteId: j.site?.id ?? null,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      gpsLat: j.lat as number,
      gpsLng: j.lng as number,
      siteLat: j.site?.lat ?? null,
      siteLng: j.site?.lng ?? null,
      verdict: proofVerdict({
        gpsLat: j.lat,
        gpsLng: j.lng,
        locatedAt: j.locatedAt,
        siteLat: j.site?.lat,
        siteLng: j.site?.lng,
        radiusM: j.site?.geofenceRadiusM,
      }),
    });
  }

  for (const v of visits) {
    // Prefer the on-site tap fix; fall back to the submission fix.
    const gLat = v.gpsLat ?? v.lat;
    const gLng = v.gpsLng ?? v.lng;
    if (gLat == null || gLng == null) continue;
    points.push({
      id: `visit:${v.id}`,
      kind: v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol",
      href: `/patrols/visits/${v.id}`,
      at: v.arrivedAt ?? v.locatedAt ?? now,
      officerId: v.officer?.id ?? null,
      officerName: v.officer?.name ?? null,
      siteId: v.site?.id ?? null,
      siteName: v.site?.name ?? null,
      siteCode: v.site?.code ?? null,
      gpsLat: gLat,
      gpsLng: gLng,
      siteLat: v.site?.lat ?? null,
      siteLng: v.site?.lng ?? null,
      verdict: proofVerdict({
        gpsLat: gLat,
        gpsLng: gLng,
        locatedAt: v.arrivedAt ?? v.locatedAt,
        siteLat: v.site?.lat,
        siteLng: v.site?.lng,
        radiusM: v.site?.geofenceRadiusM,
      }),
    });
  }

  points.sort((a, b) => b.at.getTime() - a.at.getTime());
  return points;
}
