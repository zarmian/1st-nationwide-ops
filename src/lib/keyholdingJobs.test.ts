import { describe, it, expect } from "vitest";
import {
  parseKhDateTime,
  mapKhService,
  mapKhStatus,
  matchKhSiteId,
} from "./keyholdingJobs";

describe("parseKhDateTime", () => {
  it("reads dd/MM/yyyy HH:mm as UK wall-clock", () => {
    // 14/08/2026 is BST (UTC+1).
    expect(parseKhDateTime("14/08/2026 16:48")?.toISOString()).toBe(
      "2026-08-14T15:48:00.000Z",
    );
  });
  it("returns null for blanks / junk", () => {
    expect(parseKhDateTime("")).toBeNull();
    expect(parseKhDateTime(null)).toBeNull();
    expect(parseKhDateTime("Invoiced")).toBeNull();
  });
});

describe("mapKhService", () => {
  it("maps Keyholding service codes to job types", () => {
    expect(mapKhService("UCK: Unlock")).toBe("UNLOCK");
    expect(mapKhService("ODUCK: Unlock: On-demand")).toBe("UNLOCK");
    expect(mapKhService("LCK: Lock")).toBe("LOCK");
    expect(mapKhService("ODLCK: Lock: On-demand")).toBe("LOCK");
    expect(mapKhService("ODEP: External Patrol: On-demand")).toBe("PATROL");
    expect(mapKhService("ODIP: Internal Patrol: On-demand")).toBe("PATROL");
    expect(mapKhService("AC: Alarm Call")).toBe("ALARM_RESPONSE");
    expect(mapKhService("SS: Site Survey")).toBe("SURVEY");
    expect(mapKhService("OFCOD: Officer Welfare Check: On-demand")).toBe("ADHOC");
  });
});

describe("mapKhStatus", () => {
  it("maps Execution Status to our job status", () => {
    expect(mapKhStatus("Done")).toEqual({ status: "APPROVED", done: true });
    expect(mapKhStatus("Cancelled").status).toBe("CANCELLED");
    expect(mapKhStatus("At Location").status).toBe("IN_PROGRESS");
    expect(mapKhStatus("Booked").status).toBe("OPEN");
    expect(mapKhStatus("Allocated").status).toBe("OPEN");
    expect(mapKhStatus("Waiting for Allocation").status).toBe("OPEN");
  });
});

describe("matchKhSiteId", () => {
  const idx = new Map([
    ["BR11NX", [{ id: "bromley", name: "Bromley", partnerId: "kh" }]],
    [
      "BR53FQ",
      [
        { id: "sic", name: "Science and Innovation Centre", partnerId: "kh" },
        { id: "other", name: "Other Unit", partnerId: null },
      ],
    ],
  ]);
  it("matches a unique postcode", () => {
    expect(matchKhSiteId({ postcode: "BR11NX", siteName: "x" }, idx, "kh")).toBe("bromley");
  });
  it("disambiguates a shared postcode by property name", () => {
    expect(
      matchKhSiteId(
        { postcode: "BR53FQ", siteName: "Science and Innovation Centre" },
        idx,
        "kh",
      ),
    ).toBe("sic");
  });
  it("returns null when the postcode isn't one of our sites", () => {
    expect(matchKhSiteId({ postcode: "SW1A1AA", siteName: "x" }, idx, "kh")).toBeNull();
  });
});
