import { describe, it, expect } from "vitest";
import {
  assignVisits,
  doneDetail,
  nexusLinkNote,
  nexusVisitStatus,
  stubBlocker,
  ukMonthStart,
  visitFit,
  visitUpdate,
  type StubFacts,
} from "./nexusVisits";

// 17 Oct 2026 is BST (UTC+1): 22:00 UK = 21:00Z.
const uk = (hhmm: string, day = 17) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, day, h - 1, m));
};
const visit = (id: string, at: Date, siteId = "swail") => ({ id, siteId, scheduledAt: at });

describe("visitFit", () => {
  it("fits our 22:00 patrol inside Nexus's 19:00–23:00 window (Swail House)", () => {
    expect(visitFit({ start: uk("19:00"), end: uk("23:00"), onSite: null }, uk("22:00"))).not.toBeNull();
  });

  it("allows an hour's slack around the window, but no more", () => {
    const t = { start: uk("19:00"), end: uk("23:00"), onSite: null };
    expect(visitFit(t, uk("23:45"))).not.toBeNull();
    expect(visitFit(t, uk("18:15"))).not.toBeNull();
    expect(visitFit(t, uk("00:30", 18))).toBeNull();
    expect(visitFit(t, uk("17:30"))).toBeNull();
  });

  it("prefers a visit inside the window over one in the slack", () => {
    const t = { start: uk("19:00"), end: uk("23:00"), onSite: null };
    expect(visitFit(t, uk("22:30"))!).toBeLessThan(visitFit(t, uk("23:30"))!);
  });

  it("uses the on-site time for a completed activity (3 h either way)", () => {
    const t = { start: uk("19:00"), end: null, onSite: uk("22:05") };
    expect(visitFit(t, uk("22:00"))).toBe(5 * 60_000);
    expect(visitFit(t, uk("01:30", 18))).toBeNull();
  });

  it("won't pin a week-long VPI window to one visit without an on-site time", () => {
    const week = { start: uk("00:00", 12), end: uk("00:00", 19), onSite: null };
    expect(visitFit(week, uk("22:00"))).toBeNull();
    expect(visitFit({ ...week, onSite: uk("22:10") }, uk("22:00"))).toBe(10 * 60_000);
  });

  it("falls back to ±3 h of a single due time", () => {
    expect(visitFit({ start: uk("21:00"), end: null, onSite: null }, uk("22:00"))).toBe(60 * 60_000);
    expect(visitFit({ start: uk("18:00"), end: null, onSite: null }, uk("22:00"))).toBeNull();
  });
});

describe("assignVisits", () => {
  it("pairs each of two patrols a night with its own Nexus activity", () => {
    const v22 = visit("v22", uk("22:00"));
    const v02 = visit("v02", uk("02:00", 18));
    const rows = [
      { siteId: "swail", timing: { start: uk("23:00"), end: uk("03:00", 18), onSite: null } },
      { siteId: "swail", timing: { start: uk("19:00"), end: uk("23:00"), onSite: null } },
    ];
    expect(assignVisits(rows, [v22, v02]).map((v) => v?.id)).toEqual(["v02", "v22"]);
  });

  it("matches completed activities by on-site time, best fit first across the batch", () => {
    const v22 = visit("v22", uk("22:00"));
    const v02 = visit("v02", uk("02:00", 18));
    const rows = [
      // Late for the first patrol (on site 01:30) — nearer the 02:00 visit,
      // which the second activity fits better, so it takes the 22:00 one.
      { siteId: "swail", timing: { start: uk("19:00"), end: uk("23:00"), onSite: uk("01:30", 18) } },
      { siteId: "swail", timing: { start: uk("23:00"), end: uk("03:00", 18), onSite: uk("02:05", 18) } },
    ];
    expect(assignVisits(rows, [v22, v02]).map((v) => v?.id)).toEqual(["v22", "v02"]);
  });

  it("never uses a visit twice, or one at another site", () => {
    const only = visit("v", uk("22:00"));
    const other = visit("o", uk("22:00"), "elsewhere");
    const rows = [
      { siteId: "swail", timing: { start: null, end: null, onSite: uk("22:05") } },
      { siteId: "swail", timing: { start: null, end: null, onSite: uk("22:10") } },
      null,
    ];
    expect(assignVisits(rows, [only, other]).map((v) => v?.id ?? null)).toEqual(["v", null, null]);
  });
});

describe("visit status and times", () => {
  it("moves forward to completed, including from late or missed, never back", () => {
    expect(nexusVisitStatus("PENDING", true)).toBe("COMPLETED");
    expect(nexusVisitStatus("MISSED", true)).toBe("COMPLETED");
    expect(nexusVisitStatus("LATE", true)).toBe("COMPLETED");
    expect(nexusVisitStatus("COMPLETED", true)).toBeNull();
    expect(nexusVisitStatus("CANCELLED", true)).toBeNull();
    expect(nexusVisitStatus("PENDING", false)).toBeNull();
  });

  it("only fills times the visit lacks, and leaves a cancelled visit alone", () => {
    const o = { done: true, onSite: uk("22:05"), offSite: uk("22:20") };
    expect(visitUpdate({ status: "MISSED", arrivedAt: null, departedAt: null }, o)).toEqual({
      status: "COMPLETED",
      arrivedAt: uk("22:05"),
      departedAt: uk("22:20"),
    });
    expect(visitUpdate({ status: "IN_PROGRESS", arrivedAt: uk("21:58"), departedAt: null }, o)).toEqual({
      status: "COMPLETED",
      departedAt: uk("22:20"),
    });
    expect(visitUpdate({ status: "CANCELLED", arrivedAt: null, departedAt: null }, o)).toEqual({});
  });
});

describe("stubBlocker", () => {
  const stub: StubFacts = {
    status: "APPROVED",
    cancelledByUserId: null,
    assignedToUserId: null,
    invoiceId: null,
    billedAmount: null,
    paidAmount: null,
    handledByPartnerId: null,
    recordedByUserId: null,
    patrolVisitId: null,
    _count: { formSubmissions: 0, fastfieldReports: 0 },
  };
  const free = { officerId: null, handledByPartnerId: null };

  it("merges a stub nobody has worked on, or one an auto-drop cancelled", () => {
    expect(stubBlocker(stub, free)).toBeNull();
    expect(stubBlocker({ ...stub, status: "CANCELLED" }, free)).toBeNull();
  });

  it("carries the stub's officer over, or matches the visit's", () => {
    expect(stubBlocker({ ...stub, assignedToUserId: "aisha" }, free)).toBeNull();
    expect(stubBlocker({ ...stub, assignedToUserId: "aisha" }, { ...free, officerId: "aisha" })).toBeNull();
  });

  it("keeps a stub someone has worked on", () => {
    expect(stubBlocker({ ...stub, assignedToUserId: "aisha" }, { ...free, officerId: "ben" })).toBe(
      "a different officer",
    );
    expect(stubBlocker({ ...stub, status: "CANCELLED", cancelledByUserId: "office" }, free)).toBe(
      "cancelled by hand",
    );
    expect(stubBlocker({ ...stub, status: "IN_PROGRESS" }, free)).toBe("in progress");
    expect(stubBlocker({ ...stub, invoiceId: "inv" }, free)).toBe("invoiced");
    expect(stubBlocker({ ...stub, paidAmount: 12 }, free)).toBe("has billing or pay");
    expect(stubBlocker({ ...stub, _count: { formSubmissions: 0, fastfieldReports: 1 } }, free)).toBe(
      "has a report",
    );
    expect(stubBlocker({ ...stub, handledByPartnerId: "kh" }, free)).toBe("handed to a partner");
  });
});

describe("notes and dates", () => {
  it("appends the Nexus reference to the visit's notes", () => {
    expect(nexusLinkNote(null, "LINK-1", "Scheduled VPI", doneDetail(uk("22:05"), uk("22:20")))).toBe(
      "[Nexus activity LINK-1 (Scheduled VPI) — done, on site 17 Oct, 22:05 to 22:20. Filed in Nexus's app.]",
    );
    expect(nexusLinkNote("Gate code changed", "LINK-2", null, null)).toBe(
      "Gate code changed\n[Nexus activity LINK-2. Filed in Nexus's app.]",
    );
  });

  it("starts the month at UK midnight on the 1st", () => {
    expect(ukMonthStart(uk("10:00", 18)).toISOString()).toBe("2026-09-30T23:00:00.000Z");
  });
});
