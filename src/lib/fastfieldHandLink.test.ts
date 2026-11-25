import { describe, expect, it } from "vitest";
import {
  HAND_LINK_REACH_DAYS,
  activityWords,
  besideReportText,
  gapText,
  groupSitesForLinking,
  handLinkMarkers,
  handLinkWindow,
  linkOutcome,
  otherClientWarning,
  siteOwner,
  type LinkSite,
} from "./fastfieldHandLink";
import { nearestToSpan, sortForLinking, type NearbyActivity } from "./fastfieldImport";

const at = (iso: string) => new Date(iso);
const span = { from: at("2026-11-23T22:00:00Z"), to: at("2026-11-23T22:30:00Z") };

describe("handLinkWindow", () => {
  it("covers three days either side of the report's own time by default", () => {
    const w = handLinkWindow(span);
    expect(HAND_LINK_REACH_DAYS).toBe(3);
    expect(w.day).toBeNull();
    expect(w.from.toISOString()).toBe("2026-11-20T22:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-11-26T22:30:00.000Z");
  });

  it("covers one UK calendar day when a day is picked (GMT and BST)", () => {
    const winter = handLinkWindow(span, "2026-11-30");
    expect(winter.day).toBe("2026-11-30");
    expect(winter.from.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(winter.to.toISOString()).toBe("2026-11-30T23:59:59.999Z");
    // Summer: UK midnight is 23:00 UTC the day before.
    const summer = handLinkWindow(span, "2026-07-01");
    expect(summer.from.toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(summer.to.toISOString()).toBe("2026-07-01T22:59:59.999Z");
  });

  it("ignores a day that isn't a real date, and falls back to the report's time", () => {
    for (const bad of ["2026-02-31", "31/11/2026", "", "tomorrow", null, undefined]) {
      const w = handLinkWindow(span, bad);
      expect(w.day).toBeNull();
      expect(w.from.toISOString()).toBe("2026-11-20T22:00:00.000Z");
    }
  });
});

describe("gap texts", () => {
  it("says minutes and hours up to two days, then days", () => {
    expect(gapText(45)).toBe("45 min");
    expect(gapText(190)).toBe("3 h 10 min");
    expect(gapText(26 * 60)).toBe("26 h");
    expect(gapText(3 * 1440 + 100)).toBe("3 days");
  });

  it("puts an activity before, during or after the report", () => {
    expect(besideReportText({ minutes: 45, side: "after" })).toBe("45 min after the report");
    expect(besideReportText({ minutes: 3000, side: "before" })).toBe("2 days before the report");
    expect(besideReportText({ minutes: 0, side: "during" })).toBe("during the report");
  });
});

describe("activityWords", () => {
  it("names shifts, visits and jobs", () => {
    expect(activityWords("shift", "STATIC_GUARDING")).toEqual({ label: "Static shift", noun: "static shift" });
    expect(activityWords("shift", "DOG_HANDLER").noun).toBe("dog-handler shift");
    expect(activityWords("visit", "VPI")).toEqual({ label: "VPI visit", noun: "VPI visit" });
    expect(activityWords("visit", "PATROL").noun).toBe("patrol visit");
    expect(activityWords("job", "ALARM_RESPONSE")).toEqual({ label: "Callout", noun: "callout" });
    expect(activityWords("job", "VPI").noun).toBe("VPI");
    expect(activityWords("job", "SOMETHING_NEW")).toEqual({ label: "Job", noun: "job" });
  });
});

describe("handLinkMarkers — what the robot would skip is shown, not hidden", () => {
  const job = { kind: "job" as const, type: "ALARM_RESPONSE", status: "OPEN", partner: false };

  it("leaves a job the robot could pick unmarked", () => {
    expect(handLinkMarkers(job)).toEqual([]);
  });

  it("marks cancelled, a partner's, a visit's job, a shift's job and already reported", () => {
    expect(handLinkMarkers({ ...job, status: "CANCELLED" })).toEqual(["cancelled — linking won't reopen it"]);
    expect(handLinkMarkers({ ...job, partner: true })).toEqual(["a partner's job"]);
    expect(handLinkMarkers({ ...job, forVisit: true })).toEqual(["the job of a patrol visit"]);
    expect(handLinkMarkers({ ...job, type: "STATIC_GUARDING_SHIFT" })).toEqual(["stands for a shift"]);
    expect(handLinkMarkers({ ...job, taken: true })).toEqual(["already has a report"]);
    expect(handLinkMarkers({ ...job, status: "CANCELLED", partner: true, taken: true })).toHaveLength(3);
  });

  it("marks visits and shifts the same way", () => {
    expect(handLinkMarkers({ kind: "visit", type: "PATROL", status: "CANCELLED", partner: true, taken: true })).toEqual([
      "cancelled — linking won't reopen it",
      "a partner's visit",
      "already has a report",
    ]);
    expect(handLinkMarkers({ kind: "shift", type: "STATIC_GUARDING", status: "MISSED", partner: true })).toEqual([
      "a partner's shift",
      "marked missed",
    ]);
    expect(handLinkMarkers({ kind: "shift", type: "STATIC_GUARDING", status: "ABANDONED", partner: false })).toEqual([
      "marked abandoned",
    ]);
    expect(handLinkMarkers({ kind: "shift", type: "STATIC_GUARDING", status: "COMPLETED", partner: false })).toEqual([]);
  });
});

describe("linkOutcome — the confirmation and toast match the kind", () => {
  it("a shift link changes nothing on the shift and bills nothing", () => {
    const o = linkOutcome({ kind: "shift", noun: "static shift", cancelled: false, marksDone: false });
    expect(o.effect).toMatch(/Nothing on the shift changes and nothing is billed/);
    expect(o.toast).toBe("Report linked to the shift. Nothing on the shift was changed.");
    expect(o.toast).not.toMatch(/done|billed/);
  });

  it("a job or visit not done yet is marked done and may be billed", () => {
    const o = linkOutcome({ kind: "job", noun: "callout", cancelled: false, marksDone: true });
    expect(o.effect).toMatch(/marked done/);
    expect(o.toast).toBe("Report linked — the callout is marked done and may be billed and paid.");
  });

  it("a cancelled one stays cancelled, money untouched", () => {
    const o = linkOutcome({ kind: "visit", noun: "patrol visit", cancelled: true, marksDone: false });
    expect(o.effect).toMatch(/stays cancelled: its status, times and money are left as they are/);
    expect(o.toast).toBe("Report linked. The patrol visit stays cancelled.");
  });

  it("one already done keeps its status", () => {
    const o = linkOutcome({ kind: "job", noun: "lock-up", cancelled: false, marksDone: false });
    expect(o.effect).toMatch(/already done, so its status stays/);
    expect(o.toast).toBe("Report linked to the lock-up.");
  });

  it("leaves a job that stands for a shift alone — the shift bills itself", () => {
    const o = linkOutcome({
      kind: "job",
      noun: "static shift job",
      cancelled: false,
      marksDone: false,
      standsForShift: true,
    });
    expect(o.effect).toContain("not marked done, billed or paid");
    expect(o.toast).toBe("Report linked. The static shift job was left as it is.");
  });
});

describe("otherClientWarning", () => {
  const acme = { id: "c1", name: "Acme Storage" };
  const beta = { id: "c2", name: "Beta Retail" };
  const owner = (c: { id: string; name: string }) => siteOwner({ customer: c });

  it("says nothing when the activity is the same client's", () => {
    expect(
      otherClientWarning({
        what: "callout",
        owner: owner(acme),
        formClient: acme,
        matchedSite: { name: "Riverside Storage", owner: owner(acme) },
      }),
    ).toBeNull();
  });

  it("warns when the form is for another client", () => {
    const w = otherClientWarning({ what: "callout", owner: owner(beta), formClient: acme, matchedSite: null });
    expect(w).toBe(
      "This is a different client's callout (Beta Retail): their portal will show this report. The form is for Acme Storage.",
    );
  });

  it("warns when the report's matched site is another client's", () => {
    const w = otherClientWarning({
      what: "static shift",
      owner: owner(beta),
      formClient: null,
      matchedSite: { name: "Riverside Storage", owner: owner(acme) },
    });
    expect(w).toMatch(/^This is a different client's static shift \(Beta Retail\)/);
    expect(w).toMatch(/matched to Riverside Storage \(Acme Storage\)/);
  });

  it("says nothing when it can't tell", () => {
    expect(otherClientWarning({ what: "site", owner: null, formClient: acme, matchedSite: null })).toBeNull();
    expect(otherClientWarning({ what: "site", owner: owner(beta), formClient: null, matchedSite: null })).toBeNull();
  });

  it("tells a partner's site apart from a client with the same id", () => {
    expect(siteOwner({ partner: { id: "c1", name: "Nexus Test" } })).toEqual({ key: "p:c1", name: "Nexus Test" });
    expect(siteOwner({ customer: acme, partner: { id: "p1", name: "Nexus Test" } })?.key).toBe("c:c1");
    expect(siteOwner({})).toBeNull();
  });
});

describe("groupSitesForLinking", () => {
  const site = (id: string, name: string, customer: { id: string; name: string } | null, partner = null as null | { id: string; name: string }): LinkSite => ({
    id,
    name,
    active: true,
    customer,
    partner,
  });
  const acme = { id: "a", name: "Acme Storage" };
  const beta = { id: "b", name: "Beta Retail" };
  const zeta = { id: "z", name: "Zeta Homes" };
  const sites = [
    site("1", "Alpha Park", zeta),
    site("2", "Brook Lane", null),
    site("3", "Canal Wharf", beta),
    site("4", "Dock Road", acme),
    site("5", "East Gate", null, { id: "n", name: "Nexus Test" }),
    site("6", "Fen Way", beta),
  ];

  it("puts the form's client first, then the matched site's, then the rest A–Z, no client last", () => {
    const g = groupSitesForLinking(sites, ["c:z", "c:b"]);
    expect(g.map((x) => x.label)).toEqual(["Zeta Homes", "Beta Retail", "Acme Storage", "Nexus Test (partner)", "No client"]);
    expect(g[1].sites.map((s) => s.name)).toEqual(["Canal Wharf", "Fen Way"]);
  });

  it("lists every client's sites with nothing first, and skips repeats", () => {
    const g = groupSitesForLinking(sites, [null, undefined]);
    expect(g.map((x) => x.label)).toEqual(["Acme Storage", "Beta Retail", "Nexus Test (partner)", "Zeta Homes", "No client"]);
    expect(groupSitesForLinking(sites, ["c:b", "c:b"]).map((x) => x.key)[0]).toBe("c:b");
    expect(g.reduce((n, x) => n + x.sites.length, 0)).toBe(sites.length);
  });
});

describe("nearestToSpan", () => {
  it("is 0 within the report's own time", () => {
    expect(nearestToSpan([at("2026-11-23T22:10:00Z")], span)).toMatchObject({ minutes: 0, side: "during" });
  });

  it("measures from the nearer end and keeps the nearest time", () => {
    const n = nearestToSpan([at("2026-11-23T18:00:00Z"), at("2026-11-23T23:15:00Z")], span);
    expect(n).toEqual({ at: at("2026-11-23T23:15:00Z"), minutes: 45, side: "after" });
    expect(nearestToSpan([at("2026-11-23T21:00:00Z")], span)).toMatchObject({ minutes: 60, side: "before" });
  });
});

describe("sortForLinking", () => {
  const row = (id: string, kind: NearbyActivity["kind"], minutesApart: number, outside: string | null = null): NearbyActivity => ({
    kind,
    id,
    type: kind === "shift" ? "STATIC_GUARDING" : "ALARM_RESPONSE",
    status: "PENDING",
    at: at("2026-11-23T20:00:00Z"),
    minutesApart,
    outside: kind === "shift" ? outside : undefined,
    taken: false,
    partner: false,
    marksDone: false,
  });

  it("lists the shifts the report fits first, then everything else nearest first", () => {
    const sorted = sortForLinking([
      row("job-near", "job", 5),
      row("shift-out", "shift", 50, "started 50 min before the shift"),
      row("shift-fit", "shift", 20),
      row("visit-far", "visit", 400),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["shift-fit", "job-near", "shift-out", "visit-far"]);
  });
});
