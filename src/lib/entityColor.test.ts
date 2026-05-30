import { describe, expect, it } from "vitest";
import { entityColor, siteOwner } from "./entityColor";

describe("entityColor — named brands", () => {
  it("Shurgard → red", () => {
    expect(entityColor({ name: "Shurgard" }).hex).toBe("#DC2626");
    expect(entityColor({ name: "Shurgard Wandsworth" }).hex).toBe("#DC2626");
  });

  it("Nexus → blue", () => {
    expect(entityColor({ name: "Nexus" }).hex).toBe("#2563EB");
    expect(entityColor({ name: "Nexus Security Ltd" }).hex).toBe("#2563EB");
  });

  it("Keyholding → orange", () => {
    expect(entityColor({ name: "Keyholding Company" }).hex).toBe("#EA580C");
  });

  it("Orbis → green", () => {
    expect(entityColor({ name: "Orbis" }).hex).toBe("#16A34A");
  });

  it("returns lowercase first-word as the filter key", () => {
    expect(entityColor({ name: "Shurgard Wandsworth" }).key).toBe("shurgard");
    expect(entityColor({ name: "NEXUS Security" }).key).toBe("nexus");
  });

  it("preserves the original name as label", () => {
    expect(entityColor({ name: "Shurgard Wandsworth" }).label).toBe(
      "Shurgard Wandsworth",
    );
  });
});

describe("entityColor — fallback", () => {
  it("unknown brands get a stable colour from the fallback palette", () => {
    const a = entityColor({ name: "Acme Storage" });
    const b = entityColor({ name: "Acme Storage" });
    expect(a.hex).toBe(b.hex); // deterministic
    expect(a.hex).not.toBe("#94A3B8"); // not the unassigned colour
  });

  it("different brands get different colours (typically)", () => {
    // Not strictly guaranteed by hash collisions but should hold for these.
    const a = entityColor({ name: "Acme Storage" });
    const c = entityColor({ name: "Zenith Holdings" });
    expect(a.hex).not.toBe(c.hex);
  });

  it("null/empty falls back to Unassigned slate", () => {
    expect(entityColor(null).hex).toBe("#94A3B8");
    expect(entityColor(undefined).hex).toBe("#94A3B8");
    expect(entityColor(null).label).toBe("Unassigned");
  });
});

describe("siteOwner — partner wins over customer", () => {
  it("uses partner when both partner and customer are present", () => {
    // Nexus London sites have partnerId set even if customerId is also set.
    const owner = siteOwner({
      partner: { name: "Nexus Security" },
      customer: { name: "Shurgard" },
    });
    expect(owner.key).toBe("nexus");
    expect(owner.hex).toBe("#2563EB");
  });

  it("falls back to customer when partner is absent", () => {
    const owner = siteOwner({ partner: null, customer: { name: "Shurgard" } });
    expect(owner.key).toBe("shurgard");
  });

  it("returns Unassigned when neither is set", () => {
    expect(siteOwner({}).key).toBe("_none");
  });
});
