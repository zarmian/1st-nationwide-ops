import { describe, expect, it } from "vitest";
import { haversineMeters, evaluateGeofence, DEFAULT_GEOFENCE_M } from "./geo";

describe("haversineMeters", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMeters(51.5, -0.12, 51.5, -0.12)).toBeCloseTo(0, 5);
  });

  it("matches a known short distance", () => {
    // ~111 m per 0.001° of latitude near the equator/UK.
    const d = haversineMeters(51.5, -0.12, 51.501, -0.12);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });
});

describe("evaluateGeofence", () => {
  const site = { siteLat: 51.5, siteLng: -0.12 };

  it("is within radius when GPS sits on the site", () => {
    const r = evaluateGeofence({ ...site, gpsLat: 51.5, gpsLng: -0.12 });
    expect(r.enforced).toBe(true);
    expect(r.withinRadius).toBe(true);
    expect(r.distanceM).toBeLessThan(1);
    expect(r.radiusM).toBe(DEFAULT_GEOFENCE_M);
  });

  it("is out of range past the radius", () => {
    // ~0.01° latitude ≈ 1.1 km, well past 300 m.
    const r = evaluateGeofence({ ...site, gpsLat: 51.51, gpsLng: -0.12 });
    expect(r.enforced).toBe(true);
    expect(r.withinRadius).toBe(false);
    expect(r.distanceM).toBeGreaterThan(900);
  });

  it("honours a per-site radius override", () => {
    const r = evaluateGeofence({
      ...site,
      radiusM: 2000,
      gpsLat: 51.51,
      gpsLng: -0.12,
    });
    expect(r.withinRadius).toBe(true);
    expect(r.radiusM).toBe(2000);
  });

  it("does not enforce when the site has no coordinates", () => {
    const r = evaluateGeofence({
      siteLat: null,
      siteLng: null,
      gpsLat: 51.5,
      gpsLng: -0.12,
    });
    expect(r.enforced).toBe(false);
    expect(r.withinRadius).toBe(true); // never permanently blocks
    expect(r.distanceM).toBeNull();
  });
});
