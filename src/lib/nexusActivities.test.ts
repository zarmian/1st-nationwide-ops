import { describe, it, expect } from "vitest";
import {
  parseNexusDateTime,
  parseNexusWindowEnd,
  mapJobType,
  matchSiteId,
  previewNexusActivities,
} from "./nexusActivities";

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

  it("reads the end of a due-date window", () => {
    expect(parseNexusWindowEnd("17/10/2026 19:00 - 17/10/2026 23:00")?.toISOString()).toBe(
      "2026-10-17T22:00:00.000Z",
    );
    expect(parseNexusWindowEnd("17/10/2026 19:00 - 23:00")?.toISOString()).toBe(
      "2026-10-17T22:00:00.000Z",
    );
    expect(parseNexusWindowEnd("17/10/2026 19:00")).toBeNull();
    expect(parseNexusWindowEnd(null)).toBeNull();
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

describe("site lookup when Nexus rows carry no SIN", () => {
  // Regression: a window whose completed activities had no SIN used to put a
  // blank `{ id: "" }` placeholder into the site query, which Postgres rejects
  // as a UUID — failing every sync until those rows left the window.
  const activity = (sin: string | null, address: string | null) => ({
    reference: "LINK-999001",
    type: "VPI",
    siteName: "Test site",
    address,
    sin,
    customer: "Test",
    dueDate: "14/10/2026 18:00",
    timeOnSite: "14/10/2026 18:30",
    timeOffSite: "14/10/2026 18:45",
    timeCallReceived: null,
    status: "Completed",
  });

  function fakePrisma() {
    const siteQueries: unknown[] = [];
    const prisma = {
      job: { findMany: async () => [], findFirst: async () => null },
      patrolVisit: { findMany: async () => [] },
      partner: { findUnique: async () => null },
      site: {
        findMany: async (args: unknown) => {
          siteQueries.push(args);
          return [];
        },
      },
    };
    return { prisma: prisma as never, siteQueries };
  }

  it("never queries with a blank id", async () => {
    const { prisma, siteQueries } = fakePrisma();
    await previewNexusActivities(prisma, [activity(null, "1 Test Street, London, SW1A 1AA")]);
    expect(JSON.stringify(siteQueries)).not.toContain('"id":""');
    expect(JSON.stringify(siteQueries)).toContain("postcode");
  });

  it("skips the site lookup entirely when there's nothing to match on", async () => {
    const { prisma, siteQueries } = fakePrisma();
    const res = await previewNexusActivities(prisma, [activity(null, null)]);
    expect(siteQueries).toHaveLength(0);
    expect(res.unmatchedSites).toBe(1);
  });
});
