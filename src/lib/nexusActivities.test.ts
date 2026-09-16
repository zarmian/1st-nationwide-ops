import { describe, it, expect } from "vitest";
import { parseNexusDateTime, mapJobType, matchSiteId } from "./nexusActivities";

describe("parseNexusDateTime", () => {
  it("parses dd/mm/yyyy HH:MM as UK wall-clock", () => {
    // 28/11/2024 is GMT (UTC+0).
    expect(parseNexusDateTime("28/11/2024 10:30")?.toISOString()).toBe(
      "2024-11-28T10:30:00.000Z",
    );
    // 08/07/2025 is BST (UTC+1) → an hour behind in UTC.
    expect(parseNexusDateTime("08/07/2025 07:00")?.toISOString()).toBe(
      "2025-07-08T06:00:00.000Z",
    );
  });

  it("takes the start of a due-date window", () => {
    expect(
      parseNexusDateTime("09/12/2024 00:00 - 16/12/2024 00:00")?.toISOString(),
    ).toBe("2024-12-09T00:00:00.000Z");
  });

  it("returns null for time-only or blank values", () => {
    expect(parseNexusDateTime("16:58")).toBeNull();
    expect(parseNexusDateTime("Time Call Received")).toBeNull();
    expect(parseNexusDateTime(null)).toBeNull();
  });
});

describe("mapJobType", () => {
  it("maps Nexus activity types to JobTypes", () => {
    expect(mapJobType("Scheduled Vacant Property Inspection")).toBe("VPI");
    expect(mapJobType("Scheduled Mobile Patrol")).toBe("PATROL");
    expect(mapJobType("AdHoc Alarm Response")).toBe("ALARM_RESPONSE");
    expect(mapJobType("Stop The Clock")).toBe("ADHOC");
    expect(mapJobType(null)).toBe("ADHOC");
  });
});

describe("matchSiteId", () => {
  const index = {
    bySin: new Map([
      ["609148", { id: "syon", name: "Syon", partnerId: "nexus" }],
    ]),
    byPostcode: new Map([
      [
        "SE135PL",
        [
          { id: "europcar", name: "Europcar Lewisham", partnerId: "nexus" },
          { id: "other", name: "Other unit", partnerId: null },
        ],
      ],
    ]),
  };

  it("prefers a SIN match", () => {
    expect(
      matchSiteId(
        { sin: "609148", postcode: "XX", siteName: "whatever" },
        index,
        "nexus",
      ),
    ).toBe("syon");
  });

  it("falls back to postcode + name when there's no SIN", () => {
    expect(
      matchSiteId(
        { sin: null, postcode: "SE135PL", siteName: "Europcar Lewisham" },
        index,
        "nexus",
      ),
    ).toBe("europcar");
  });

  it("returns null when nothing matches", () => {
    expect(
      matchSiteId({ sin: null, postcode: "N1 1AA", siteName: "x" }, index, "nexus"),
    ).toBeNull();
  });
});
