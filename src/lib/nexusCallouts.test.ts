import { describe, it, expect } from "vitest";
import { parseNexusDateTime, matchSiteId } from "./nexusCallouts";

describe("parseNexusDateTime", () => {
  it("parses the dashboard's dd/mm/yyyy HH:MM as UK time", () => {
    // September / October 2026 are BST (UTC+1).
    expect(parseNexusDateTime("07/09/2026 00:00")?.toISOString()).toBe(
      "2026-09-06T23:00:00.000Z",
    );
    expect(parseNexusDateTime("15/10/2026 13:30")?.toISOString()).toBe(
      "2026-10-15T12:30:00.000Z",
    );
    // December is GMT (UTC+0).
    expect(parseNexusDateTime("01/12/2026 19:00")?.toISOString()).toBe(
      "2026-12-01T19:00:00.000Z",
    );
  });

  it("accepts a bare date (defaults to UK midnight)", () => {
    expect(parseNexusDateTime("28/08/2026")?.toISOString()).toBe(
      "2026-08-27T23:00:00.000Z",
    );
  });

  it("returns null for junk / empty", () => {
    expect(parseNexusDateTime(null)).toBeNull();
    expect(parseNexusDateTime("")).toBeNull();
    expect(parseNexusDateTime("Due Now")).toBeNull();
    expect(parseNexusDateTime("2026-09-07")).toBeNull();
  });
});

describe("matchSiteId", () => {
  const idx = new Map<
    string,
    { id: string; name: string; partnerId: string | null }[]
  >([
    ["BR60NS", [{ id: "s1", name: "235 High Street Orpington", partnerId: "nexus" }]],
    [
      "BR68NW",
      [
        { id: "s2", name: "6535 Morrisons 336/338 Crofton Road", partnerId: "nexus" },
        { id: "s3", name: "Some other unit", partnerId: null },
      ],
    ],
  ]);

  it("uses a unique postcode match", () => {
    expect(
      matchSiteId({ postcode: "BR60NS", siteName: "whatever" }, idx, "nexus"),
    ).toBe("s1");
  });

  it("disambiguates a shared postcode by name", () => {
    expect(
      matchSiteId(
        { postcode: "BR68NW", siteName: "6535 Morrisons 336/338 crofton road" },
        idx,
        "nexus",
      ),
    ).toBe("s2");
  });

  it("prefers a live site to a switched-off copy at the same postcode", () => {
    const twins = new Map([
      [
        "KT185AZ",
        [
          { id: "old", name: "Swail House", partnerId: "nexus", active: false },
          { id: "real", name: "Swail House, Ashley Road, Epsom, KT18 5AZ", partnerId: "nexus", active: true },
        ],
      ],
    ]);
    expect(matchSiteId({ postcode: "KT185AZ", siteName: "Swail House" }, twins, "nexus")).toBe("real");
  });

  it("returns null when the postcode isn't known (caller keeps it site-less)", () => {
    expect(
      matchSiteId({ postcode: "SW1A1AA", siteName: "x" }, idx, "nexus"),
    ).toBeNull();
    expect(matchSiteId({ postcode: null, siteName: "x" }, idx, "nexus")).toBeNull();
  });
});
