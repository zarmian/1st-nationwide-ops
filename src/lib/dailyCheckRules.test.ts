import { describe, it, expect } from "vitest";
import {
  findDuplicatePairs,
  keywordIncidents,
  reportIssues,
  reportText,
  type CheckActivity,
  type ReportCheckInput,
} from "./dailyCheckRules";
import type { FastFieldAnswer } from "./fastfield";

const t = (hhmm: string, day = "17") => new Date(`2026-10-${day}T${hhmm}:00.000Z`);

function act(over: Partial<CheckActivity> & { id: string }): CheckActivity {
  return {
    kind: "job",
    siteId: "swail",
    type: "PATROL",
    source: "Nexus",
    main: t("22:00"),
    times: [],
    status: "APPROVED",
    ...over,
  };
}

describe("findDuplicatePairs", () => {
  it("pairs our scheduled patrol with the Nexus activity for the same night (Swail House)", () => {
    const nexus = act({ id: "nexus", main: t("22:05"), times: [t("19:00"), t("22:05"), t("22:20")] });
    const ours = act({ id: "visit", kind: "visit", source: "Our schedule", main: t("22:00"), times: [t("22:00")], status: "PENDING" });
    const pairs = findDuplicatePairs([nexus, ours]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map((a) => a.id).sort()).toEqual(["nexus", "visit"]);
  });

  it("pairs each of two weekend patrols with its own Nexus activity", () => {
    const n1 = act({ id: "n1", main: t("22:05"), times: [t("19:00"), t("22:05"), t("22:20")] });
    const n2 = act({ id: "n2", main: t("02:05", "18"), times: [t("23:00"), t("02:05", "18"), t("02:20", "18")] });
    const v1 = act({ id: "v1", kind: "visit", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    const v2 = act({ id: "v2", kind: "visit", source: "Our schedule", main: t("02:00", "18"), times: [t("02:00", "18")] });
    const pairs = findDuplicatePairs([n1, n2, v1, v2]).map((p) => p.map((a) => a.id).sort().join("+"));
    expect(pairs.sort()).toEqual(["n1+v1", "n2+v2"]);
  });

  it("doesn't pair two of our own patrols hours apart, or different kinds of work", () => {
    const v1 = act({ id: "v1", kind: "visit", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    const v2 = act({ id: "v2", kind: "visit", source: "Our schedule", main: t("23:15"), times: [t("23:15")] });
    const lock = act({ id: "lock", type: "LOCK", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    expect(findDuplicatePairs([v1, v2, lock])).toHaveLength(0);
  });

  it("ignores a job that stands for its own patrol visit", () => {
    const visit = act({ id: "v", kind: "visit", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    const job = act({ id: "j", source: "Keyholding", visitId: "v", main: t("22:00"), times: [t("22:00")] });
    expect(findDuplicatePairs([visit, job])).toHaveLength(0);
  });

  it("catches a callout logged twice", () => {
    const office = act({ id: "o", type: "ALARM_RESPONSE", source: "Recorded by the office", main: t("21:10"), times: [t("21:00"), t("21:40")] });
    const ff = act({ id: "f", type: "ALARM_RESPONSE", source: "FastField report", main: t("21:15"), times: [t("21:15"), t("21:45")] });
    expect(findDuplicatePairs([office, ff])).toHaveLength(1);
  });

  it("treats our own patrol and VPI at one time as two services, but Nexus's VPI as our patrol", () => {
    const patrol = act({ id: "p", kind: "visit", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    const vpi = act({ id: "v", kind: "visit", type: "VPI", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    expect(findDuplicatePairs([patrol, vpi])).toHaveLength(0);
    const nexusVpi = act({ id: "n", type: "VPI", main: t("22:10"), times: [t("19:00"), t("22:10")] });
    expect(findDuplicatePairs([patrol, nexusVpi])).toHaveLength(1);
  });

  it("doesn't pair records at different sites", () => {
    const a = act({ id: "a", main: t("22:00"), times: [t("22:00")] });
    const b = act({ id: "b", siteId: "other", source: "Our schedule", main: t("22:00"), times: [t("22:00")] });
    expect(findDuplicatePairs([a, b])).toHaveLength(0);
  });
});

describe("reportIssues", () => {
  const site = {
    id: "stockwell",
    name: "Shurgard Stockwell",
    postcode: "SW9 6AE",
    lat: 51.4721,
    lng: -0.1146,
    geofenceRadiusM: null,
  };
  const base: ReportCheckInput = {
    siteText: "Stockwell",
    lat: 51.4722,
    lng: -0.1147,
    site,
    nameFits: { ids: ["stockwell"], firstName: "Shurgard Stockwell" },
    reportKind: "PATROL",
    linkedKind: "SHIFT",
    officerText: "Aisha Khan",
    officerKnown: true,
  };

  it("finds nothing wrong with a report that fits", () => {
    expect(reportIssues(base)).toEqual([]);
  });

  it("flags GPS far from the site", () => {
    const issues = reportIssues({ ...base, lat: 51.55, lng: -0.25 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/km from Shurgard Stockwell/);
  });

  it("flags a site name that reads like another site", () => {
    const issues = reportIssues({
      ...base,
      siteText: "Camden",
      nameFits: { ids: ["camden"], firstName: "Shurgard Camden" },
    });
    expect(issues[0]).toMatch(/names the site “Camden” \(which reads like Shurgard Camden\), but it was attached to Shurgard Stockwell/);
  });

  it("accepts the site's postcode as its name, and flags a different postcode", () => {
    expect(reportIssues({ ...base, siteText: "SW9 6AE", nameFits: { ids: [], firstName: null } })).toEqual([]);
    expect(reportIssues({ ...base, siteText: "NW1 0DD" })[0]).toMatch(/postcode NW10DD, but Shurgard Stockwell is SW9 6AE/);
  });

  it("flags the wrong form for the job", () => {
    expect(reportIssues({ ...base, reportKind: "PATROL", linkedKind: "ALARM_RESPONSE" })[0]).toMatch(
      /form is for a patrol, but it was attached to a callout/,
    );
    expect(reportIssues({ ...base, reportKind: "ALARM_RESPONSE", linkedKind: "SHIFT" })[0]).toMatch(
      /form is for a callout, but it was attached to a static shift/,
    );
    expect(reportIssues({ ...base, reportKind: "UNLOCK", linkedKind: "LOCK" })[0]).toMatch(/an unlock, but .* a lock-up/);
  });

  it("flags an officer who isn't on the staff list", () => {
    expect(reportIssues({ ...base, officerKnown: false })[0]).toMatch(/isn't on the staff list/);
  });
});

describe("keywordIncidents", () => {
  const text = (label: string, value: unknown): FastFieldAnswer => ({ key: label, label, type: "MultiLineEntry", value });
  const tri = (label: string, value: number): FastFieldAnswer => ({ key: label, label, type: "ThreeState", value });

  it("spots incidents in the notes", () => {
    const found = keywordIncidents([
      text("Issue/Observation/Incident Report", "Rear shutter found open, police called and attended."),
    ]);
    expect(found.map((f) => f.category)).toEqual(["Emergency services", "Insecure site"]);
  });

  it("ignores routine all-clear reports and negated words", () => {
    expect(keywordIncidents([text("Notes", "All secure")])).toEqual([]);
    expect(keywordIncidents([text("Notes", "No sign of damage or forced entry")])).toEqual([]);
  });

  it("counts a Yes to an incident question", () => {
    expect(keywordIncidents([tri("Fire Services/Police Called? Yes/No", 1)])[0].category).toBe(
      "Emergency services",
    );
    expect(keywordIncidents([tri("Fire Services/Police Called? Yes/No", 0)])).toEqual([]);
  });
});

describe("reportText", () => {
  it("keeps the written answers and leaves out photos, GPS and times", () => {
    const out = reportText([
      { key: "a", label: "Site Name", type: "SingleLineEntryAlpha", value: "Stockwell" },
      { key: "b", label: "Photos", type: "MultiPhotoPicker", value: [{ url: "https://x/y.jpg" }] },
      { key: "c", label: "Arrive", type: "DatePicker", value: "2026-10-17T22:00:00Z" },
      { key: "d", label: "Police called?", type: "ThreeState", value: 0 },
      { key: "e", label: "Notes", type: "MultiLineEntry", value: "Gate damaged" },
    ]);
    expect(out).toBe("Site Name: Stockwell\nPolice called?: No\nNotes: Gate damaged");
  });
});
