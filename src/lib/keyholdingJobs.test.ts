import { describe, it, expect } from "vitest";
import {
  parseKhDateTime,
  mapKhService,
  mapKhStatus,
  matchKhSiteId,
  mergeKhStatus,
  resolveKeyholdingPartner,
} from "./keyholdingJobs";

/** Minimal stand-in for prisma.partner, enough for the resolver. */
function fakePrisma(names: string[]) {
  const partners = names.map((name, i) => ({ id: `p${i}`, name }));
  return {
    partner: {
      findUnique: async ({ where }: any) =>
        partners.find((p) => p.name === where.name) ?? null,
      findMany: async ({ where }: any) => {
        if (!where) return partners;
        return partners.filter((p) =>
          (where.OR as any[]).some((o) =>
            p.name.toLowerCase().includes(String(o.name.contains).toLowerCase()),
          ),
        );
      },
    },
  } as any;
}

describe("resolveKeyholdingPartner", () => {
  it("uses the seed name when it exists", async () => {
    const p = await resolveKeyholdingPartner(fakePrisma(["Nexus Security", "Keyholding Company"]));
    expect(p?.name).toBe("Keyholding Company");
  });
  it("finds a hand-named partner like 'Keyholding Co'", async () => {
    const p = await resolveKeyholdingPartner(fakePrisma(["Nexus Security", "Keyholding Co"]));
    expect(p?.name).toBe("Keyholding Co");
  });
  it("falls back to a KHC-named partner", async () => {
    const p = await resolveKeyholdingPartner(fakePrisma(["KHC Ltd", "Nexus Security"]));
    expect(p?.name).toBe("KHC Ltd");
  });
  it("refuses to guess when it's ambiguous or missing", async () => {
    expect(
      await resolveKeyholdingPartner(fakePrisma(["Keyholding Co", "Keyholding Co (old)"])),
    ).toBeNull();
    expect(await resolveKeyholdingPartner(fakePrisma(["Nexus Security"]))).toBeNull();
  });
});

describe("mergeKhStatus (linking to an existing scheduled job)", () => {
  it("moves a job forward when Keyholding says it's done", () => {
    expect(mergeKhStatus("OPEN", "APPROVED")).toBe("APPROVED");
    expect(mergeKhStatus("ASSIGNED", "APPROVED")).toBe("APPROVED");
    expect(mergeKhStatus("OPEN", "IN_PROGRESS")).toBe("IN_PROGRESS");
  });
  it("never moves a job backwards", () => {
    expect(mergeKhStatus("ASSIGNED", "OPEN")).toBeNull(); // keep the allocation
    expect(mergeKhStatus("APPROVED", "OPEN")).toBeNull();
    expect(mergeKhStatus("APPROVED", "APPROVED")).toBeNull();
  });
  it("cancels only work that isn't done, and never touches a cancelled job", () => {
    expect(mergeKhStatus("OPEN", "CANCELLED")).toBe("CANCELLED");
    expect(mergeKhStatus("APPROVED", "CANCELLED")).toBeNull();
    expect(mergeKhStatus("CANCELLED", "APPROVED")).toBeNull();
  });
});

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
