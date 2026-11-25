import { describe, it, expect } from "vitest";
import { answerKind, groupByPlace } from "./fastfield";
import {
  broughtBackNote,
  createdByHand,
  placesFromCounts,
  retryMessage,
  takenOffText,
  TIME_ANSWER_TYPES,
  type PlaceCount,
} from "./fastfieldAdminList";

const at = (day: number, hour = 21) => new Date(Date.UTC(2026, 10, day, hour));

describe("placesFromCounts", () => {
  // One row per spelling + matched site, as the database's group-by returns.
  const counts: PlaceCount[] = [
    { siteText: "Fern Court", siteName: null, count: 1, latest: at(1) },
    { siteText: "fern court", siteName: null, count: 1, latest: at(2) },
    { siteText: "Fern  Court", siteName: null, count: 1, latest: at(3) },
    { siteText: "AB12CD", siteName: null, count: 2, latest: at(6) },
    { siteText: "AB1 2CD", siteName: null, count: 1, latest: at(5) },
    { siteText: "Mill Yard", siteName: "Mill Yard Depot", count: 1, latest: at(7) },
    { siteText: null, siteName: null, count: 4, latest: at(8) },
    { siteText: "  ", siteName: null, count: 1, latest: at(9) },
  ];

  it("groups by place, biggest first, then the most recent; leaves out reports with no site typed", () => {
    const g = placesFromCounts(counts);
    expect(g.map((x) => [x.key, x.count])).toEqual([
      ["ab12cd", 3],
      ["ferncourt", 3],
      ["millyard", 1],
    ]);
    expect(g[0].latest).toEqual(at(6));
  });

  it("labels a group with the spelling typed most often, across rows that tidy to the same spelling", () => {
    const g = placesFromCounts(counts);
    expect(g.find((x) => x.key === "ab12cd")?.label).toBe("AB12CD");
    // "Fern Court" (1) and "Fern  Court" (1) are one spelling once spaces are tidied: 2 beats "fern court".
    expect(g.find((x) => x.key === "ferncourt")?.label).toBe("Fern Court");
    expect(g.find((x) => x.key === "millyard")?.siteName).toBe("Mill Yard Depot");
    expect(g.find((x) => x.key === "ab12cd")?.siteName).toBeNull();
  });

  it("names the site most of a place's reports were matched to, the latest on a tie", () => {
    const g = placesFromCounts([
      { siteText: "Riverside", siteName: "Riverside Storage", count: 2, latest: at(3) },
      { siteText: "Riverside", siteName: "Riverside Lofts", count: 5, latest: at(1) },
      { siteText: "riverside", siteName: null, count: 9, latest: at(4) },
      { siteText: "Quay", siteName: "Quay North", count: 1, latest: at(1) },
      { siteText: "Quay", siteName: "Quay South", count: 1, latest: at(2) },
    ]);
    expect(g[0]).toMatchObject({ key: "riverside", count: 16, label: "riverside", siteName: "Riverside Lofts" });
    expect(g[1]).toMatchObject({ key: "quay", siteName: "Quay South" });
  });

  it("gives the same groups as grouping the reports one by one", () => {
    // Fictional waiting reports, then the same reports counted the way the
    // database does it (by exact spelling and matched site).
    const reports = [
      ["Harbour View", "Harbour View Storage", 1],
      ["harbour view", "Harbour View Storage", 2],
      ["Harbour View", null, 3],
      ["HV1 2AB", null, 4],
      ["hv12ab", null, 5],
      ["Elm Park", "Elm Park Depot", 6],
      ["Elm  Park", "Elm Park Depot", 7],
      ["Elm Park", "Elm Park Depot", 8],
      ["Canal St", null, 9],
      [null, null, 10],
    ] as const;
    const one = reports.map(([siteText, siteName, day]) => ({ siteText, siteName, submittedAt: at(day) }));
    const byRow = new Map<string, PlaceCount>();
    for (const r of one) {
      const k = `${r.siteText}|${r.siteName}`;
      const c = byRow.get(k) ?? { siteText: r.siteText, siteName: r.siteName, count: 0, latest: r.submittedAt };
      c.count++;
      if (r.submittedAt > c.latest) c.latest = r.submittedAt;
      byRow.set(k, c);
    }
    const strip = (g: { key: string; label: string; count: number; siteName: string | null; latest: Date }[]) =>
      g.map(({ key, label, count, siteName, latest }) => ({ key, label, count, siteName, latest }));
    expect(strip(placesFromCounts([...byRow.values()]))).toEqual(strip(groupByPlace(one)));
  });
});

describe("TIME_ANSWER_TYPES", () => {
  const types = [
    "DatePicker",
    "TimePicker",
    "DateTimePicker",
    "Date",
    "Time",
    "datetime",
    "Timer",
    "SingleLineEntry",
    "SingleLineEntryAlpha",
    "MultiLineEntry",
    "MultiPhotoPicker",
    "SignatureCapture",
    "LocationPicker",
    "ListPicker",
    "ThreeState",
    "Barcode",
  ];

  it("keeps every answer a time can be read from", () => {
    for (const t of types) {
      if (answerKind(t) === "date") expect(TIME_ANSWER_TYPES.test(t), t).toBe(true);
    }
  });

  it("leaves out photos, signatures, places and text", () => {
    for (const t of ["SingleLineEntry", "MultiLineEntry", "MultiPhotoPicker", "SignatureCapture", "LocationPicker", "ListPicker"]) {
      expect(TIME_ANSWER_TYPES.test(t), t).toBe(false);
    }
  });
});

describe("broughtBackNote", () => {
  it("says the robot tries again a report nobody took off a shift", () => {
    expect(broughtBackNote("Ana Admin", "robot_tries")).toBe("Brought back by Ana Admin. The robot tries it again.");
  });

  it("says a report the robot took off only goes back on a shift it fits", () => {
    const note = broughtBackNote("Ana Admin", "robot_puts_back");
    expect(note).toContain("puts it back on a shift there that it fits");
    expect(note).toContain("otherwise it waits for you");
    expect(note).not.toContain("tries it again");
    // Older put-back code found the robot's own take-offs by these words.
    expect(note).toContain("by the robot:");
  });

  it("says a report a person took off a shift waits for a person", () => {
    const note = broughtBackNote("Ana Admin", "waits_for_you");
    expect(note).toContain("waits for you");
    expect(note).not.toContain("robot tries");
    expect(note).not.toContain("by the robot:");
  });
});

describe("takenOffText", () => {
  it("says nothing when no waiting report was taken off a shift", () => {
    expect(takenOffText(0, 0)).toBeNull();
  });

  it("splits reports taken off by a person from those the robot took off", () => {
    expect(takenOffText(2, 1)).toBe("3 of them were taken off a shift: 2 by a person and 1 by the robot — each says why.");
    expect(takenOffText(0, 4)).toBe("4 of them were taken off a shift: 4 by the robot — each says why.");
    expect(takenOffText(1, 0)).toBe("1 of them was taken off a shift: 1 by a person — it says why.");
  });
});

describe("retryMessage", () => {
  it("says the robot is busy when another run holds the lock", () => {
    expect(retryMessage({ attached: 0, checked: 0, notReached: 0, busy: true })).toEqual({
      tone: "info",
      message: "The robot is matching right now — try again in a minute.",
    });
  });

  it("counts what was attached, and what is left to check", () => {
    expect(retryMessage({ attached: 1, checked: 5, notReached: 0 })).toEqual({ tone: "success", message: "Attached 1 report." });
    expect(retryMessage({ attached: 3, checked: 40, notReached: 12 })).toEqual({
      tone: "success",
      message: "Attached 3 reports. Checked 40 — press again to check the other 12.",
    });
    expect(retryMessage({ attached: 0, checked: 7, notReached: 0 })).toEqual({ tone: "info", message: "Nothing new matched." });
  });
});

describe("createdByHand", () => {
  it("trusts the job's history: a person's name means by hand, none means the robot", () => {
    expect(createdByHand({ note: "Job at Riverside Storage created by Ana Admin." }, [{ userId: null }])).toBe(false);
    expect(createdByHand({ note: "The callout at Riverside Storage was created from this report." }, [{ userId: "u1" }])).toBe(true);
  });

  it("falls back to the note for jobs made before the history existed", () => {
    expect(createdByHand({ note: "Job at Riverside Storage created by Ana Admin." }, [])).toBe(true);
    expect(createdByHand({ note: "The callout at Riverside Storage was created from this report." }, undefined)).toBe(false);
    expect(createdByHand({ note: null }, undefined)).toBe(false);
  });
});
