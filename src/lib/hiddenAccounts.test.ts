import { describe, it, expect } from "vitest";
import {
  jobHiddenAnd,
  siteRefHiddenAnd,
  siteHiddenAnd,
  customerHiddenAnd,
  partnerHiddenAnd,
  hiddenSiteSet,
  type HiddenScope,
} from "./hiddenAccounts";

const inert: HiddenScope = {
  active: false,
  customerIds: [],
  partnerIds: [],
  siteIds: [],
};
const scope: HiddenScope = {
  active: true,
  customerIds: ["c1"],
  partnerIds: ["p1", "p2"],
  siteIds: ["s1", "s2"],
};

describe("inert scope (non-admin / nothing hidden)", () => {
  it("produces no fragments", () => {
    expect(jobHiddenAnd(inert)).toEqual([]);
    expect(siteRefHiddenAnd(inert)).toEqual([]);
    expect(siteHiddenAnd(inert)).toEqual([]);
    expect(hiddenSiteSet(inert).size).toBe(0);
  });
});

describe("jobHiddenAnd", () => {
  it("excludes by site, customer and partner — each null-safe", () => {
    const f = jobHiddenAnd(scope);
    expect(f).toEqual([
      { OR: [{ siteId: null }, { siteId: { notIn: ["s1", "s2"] } }] },
      { OR: [{ customerId: null }, { customerId: { notIn: ["c1"] } }] },
      { OR: [{ partnerId: null }, { partnerId: { notIn: ["p1", "p2"] } }] },
    ]);
  });
});

describe("siteRefHiddenAnd", () => {
  it("excludes rows on a hidden site (null-safe)", () => {
    expect(siteRefHiddenAnd(scope)).toEqual([
      { OR: [{ siteId: null }, { siteId: { notIn: ["s1", "s2"] } }] },
    ]);
  });
});

describe("siteHiddenAnd", () => {
  it("excludes hidden site ids directly", () => {
    expect(siteHiddenAnd(scope)).toEqual([{ id: { notIn: ["s1", "s2"] } }]);
  });
});

describe("customerHiddenAnd / partnerHiddenAnd", () => {
  it("exclude by direct customer / partner id (null-safe)", () => {
    expect(customerHiddenAnd(scope)).toEqual([
      { OR: [{ customerId: null }, { customerId: { notIn: ["c1"] } }] },
    ]);
    expect(partnerHiddenAnd(scope)).toEqual([
      { OR: [{ partnerId: null }, { partnerId: { notIn: ["p1", "p2"] } }] },
    ]);
  });
  it("are empty for an inert scope", () => {
    expect(customerHiddenAnd(inert)).toEqual([]);
    expect(partnerHiddenAnd(inert)).toEqual([]);
  });
});

describe("hiddenSiteSet", () => {
  it("is the set of hidden site ids", () => {
    const set = hiddenSiteSet(scope);
    expect(set.has("s1")).toBe(true);
    expect(set.has("s9")).toBe(false);
  });
});
