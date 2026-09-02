import { describe, it, expect } from "vitest";
import {
  proofVerdict,
  proofSummary,
  summarisePresence,
  type PresencePoint,
} from "./proofOfPresence";

// A site in central London; a fix ~40 m away and one ~2 km away.
const siteLat = 51.5074;
const siteLng = -0.1278;

describe("proofVerdict", () => {
  it("is 'within' for a fix inside the geofence", () => {
    const v = proofVerdict({
      gpsLat: 51.5074,
      gpsLng: -0.1272, // ~40 m east
      siteLat,
      siteLng,
    });
    expect(v.status).toBe("within");
    expect(v.withinGeofence).toBe(true);
    expect(v.enforced).toBe(true);
    expect(v.distanceM).toBeGreaterThan(0);
    expect(v.distanceM).toBeLessThan(300);
  });

  it("is 'outside' for a fix beyond the radius", () => {
    const v = proofVerdict({
      gpsLat: 51.525, // ~2 km north
      gpsLng: -0.1278,
      siteLat,
      siteLng,
    });
    expect(v.status).toBe("outside");
    expect(v.withinGeofence).toBe(false);
    expect(v.distanceM).toBeGreaterThan(300);
  });

  it("honours a per-site radius override", () => {
    const v = proofVerdict({
      gpsLat: 51.5074,
      gpsLng: -0.1272, // ~40 m
      siteLat,
      siteLng,
      radiusM: 20, // tighter than the ~40 m distance
    });
    expect(v.status).toBe("outside");
    expect(v.radiusM).toBe(20);
  });

  it("is 'no_site_coords' when the site has no location", () => {
    const v = proofVerdict({
      gpsLat: 51.5,
      gpsLng: -0.12,
      siteLat: null,
      siteLng: null,
    });
    expect(v.status).toBe("no_site_coords");
    expect(v.withinGeofence).toBeNull();
    expect(v.enforced).toBe(false);
  });

  it("is 'no_fix' when the officer has no GPS", () => {
    const v = proofVerdict({
      gpsLat: null,
      gpsLng: null,
      siteLat,
      siteLng,
    });
    expect(v.status).toBe("no_fix");
    expect(v.hasFix).toBe(false);
    expect(proofSummary(v)).toBe("No GPS captured");
  });
});

describe("summarisePresence", () => {
  const mk = (status: PresencePoint["verdict"]["status"]): PresencePoint => ({
    id: "x",
    kind: "Patrol",
    href: "#",
    at: new Date(),
    officerId: null,
    officerName: null,
    siteId: null,
    siteName: null,
    siteCode: null,
    gpsLat: 0,
    gpsLng: 0,
    siteLat: null,
    siteLng: null,
    verdict: {
      hasFix: status !== "no_fix",
      gpsLat: 0,
      gpsLng: 0,
      locatedAt: null,
      distanceM: null,
      withinGeofence:
        status === "within" ? true : status === "outside" ? false : null,
      enforced: status === "within" || status === "outside",
      radiusM: 300,
      status,
    },
  });

  it("counts within / outside and the within%", () => {
    const s = summarisePresence([
      mk("within"),
      mk("within"),
      mk("within"),
      mk("outside"),
      mk("no_site_coords"),
      mk("no_fix"),
    ]);
    expect(s.total).toBe(6);
    expect(s.enforced).toBe(4); // 3 within + 1 outside
    expect(s.within).toBe(3);
    expect(s.outside).toBe(1);
    expect(s.noSiteCoords).toBe(1);
    expect(s.withinPct).toBe(75); // 3/4
  });

  it("returns null within% when nothing is enforceable", () => {
    const s = summarisePresence([mk("no_site_coords"), mk("no_fix")]);
    expect(s.withinPct).toBeNull();
  });
});
