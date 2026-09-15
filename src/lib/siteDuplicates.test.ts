import { describe, it, expect } from "vitest";
import { findDuplicateSites, normaliseNameKey } from "./siteDuplicates";

describe("normaliseNameKey", () => {
  it("collapses case, punctuation and spacing", () => {
    expect(normaliseNameKey("Shurgard  Wembley")).toBe("shurgard wembley");
    expect(normaliseNameKey("Shurgard - Wembley")).toBe("shurgard wembley");
    expect(normaliseNameKey("SHURGARD, WEMBLEY!")).toBe("shurgard wembley");
  });
});

describe("findDuplicateSites", () => {
  it("flags same-name pairs (manual add + import)", () => {
    const dup = findDuplicateSites([
      { id: "a", name: "Shurgard Wembley", postcode: "HA9 0FJ" },
      { id: "b", name: "Shurgard - Wembley", postcode: "HA9 0AA" }, // diff pc
      { id: "c", name: "Aegis House", postcode: "N1 7GU" },
    ]);
    expect(dup.get("a")).toEqual({ byName: true, byPostcode: false });
    expect(dup.get("b")).toEqual({ byName: true, byPostcode: false });
    expect(dup.has("c")).toBe(false);
  });

  it("flags same-postcode pairs even with different names", () => {
    const dup = findDuplicateSites([
      { id: "a", name: "Unit 1 Depot", postcode: "SW1A 1AA" },
      { id: "b", name: "Unit 2 Depot", postcode: "sw1a1aa" }, // same pc, spacing/case
      { id: "c", name: "Somewhere Else", postcode: "E1 6AN" },
    ]);
    expect(dup.get("a")).toEqual({ byName: false, byPostcode: true });
    expect(dup.get("b")).toEqual({ byName: false, byPostcode: true });
    expect(dup.has("c")).toBe(false);
  });

  it("marks both reasons when name and postcode match", () => {
    const dup = findDuplicateSites([
      { id: "a", name: "Same Site", postcode: "M1 1AA" },
      { id: "b", name: "same site", postcode: "M1 1AA" },
    ]);
    expect(dup.get("a")).toEqual({ byName: true, byPostcode: true });
  });

  it("ignores blank names/postcodes and unique sites", () => {
    const dup = findDuplicateSites([
      { id: "a", name: "Alpha", postcode: null },
      { id: "b", name: "Beta", postcode: "" },
      { id: "c", name: "Gamma", postcode: "G1 1AA" },
    ]);
    expect(dup.size).toBe(0);
  });
});
