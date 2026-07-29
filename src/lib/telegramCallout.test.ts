import { describe, expect, it } from "vitest";
import {
  calloutCancelData,
  calloutConfirmData,
  decodeCalloutAction,
  decodeJobAction,
  jobActionData,
  matchPerson,
  matchSite,
  resolveCallout,
  type ResolveContext,
} from "./telegramCallout";

const SITES = [
  { id: "s1", name: "Shurgard Neasden", code: "SHU-NEAS", postcode: "NW10 1AB" },
  { id: "s2", name: "Shurgard Norbury", code: "SHU-NORB", postcode: "SW16 4AB" },
  {
    id: "s3",
    name: "Access Storage Croydon",
    code: "ACC-CROY",
    postcode: "CR0 2AB",
  },
];

const OFFICERS = [
  { id: "o1", name: "John Smith" },
  { id: "o2", name: "Jane Doe" },
  { id: "o3", name: "John Baker" },
];

const PARTNERS = [
  { id: "p1", name: "Nexus Security" },
  { id: "p2", name: "Keyholding Company" },
];

const CTX: ResolveContext = {
  sites: SITES,
  officers: OFFICERS,
  partners: PARTNERS,
};

describe("matchSite", () => {
  it("matches a unique substring of the name", () => {
    const m = matchSite("Neasden", SITES);
    expect(m.kind).toBe("one");
    if (m.kind === "one") expect(m.site.id).toBe("s1");
  });

  it("matches an exact code", () => {
    const m = matchSite("SHU-NORB", SITES);
    expect(m.kind).toBe("one");
    if (m.kind === "one") expect(m.site.id).toBe("s2");
  });

  it("matches by postcode", () => {
    const m = matchSite("NW10", SITES);
    expect(m.kind).toBe("one");
    if (m.kind === "one") expect(m.site.id).toBe("s1");
  });

  it("returns many when a query hits several sites", () => {
    const m = matchSite("Shurgard", SITES);
    expect(m.kind).toBe("many");
    if (m.kind === "many") expect(m.sites).toHaveLength(2);
  });

  it("returns none for an unknown site", () => {
    expect(matchSite("Wembley", SITES).kind).toBe("none");
  });

  it("returns none for an empty query", () => {
    expect(matchSite("   ", SITES).kind).toBe("none");
  });
});

describe("matchPerson", () => {
  it("matches a unique first name", () => {
    const m = matchPerson("Jane", OFFICERS);
    expect(m.kind).toBe("one");
    if (m.kind === "one") expect(m.person.id).toBe("o2");
  });

  it("is ambiguous when a first name matches several", () => {
    const m = matchPerson("John", OFFICERS);
    expect(m.kind).toBe("many");
    if (m.kind === "many") expect(m.people).toHaveLength(2);
  });

  it("resolves the ambiguity with a surname", () => {
    const m = matchPerson("John Baker", OFFICERS);
    expect(m.kind).toBe("one");
    if (m.kind === "one") expect(m.person.id).toBe("o3");
  });

  it("returns none when nobody matches", () => {
    expect(matchPerson("Nobody", OFFICERS).kind).toBe("none");
  });
});

describe("resolveCallout", () => {
  it("resolves a full officer callout and defaults the source from the type", () => {
    const r = resolveCallout(
      {
        siteQuery: "Neasden",
        type: "ALARM_RESPONSE",
        handlerKind: "officer",
        officerName: "Jane",
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    expect(r.data).toBeDefined();
    expect(r.data?.siteId).toBe("s1");
    expect(r.data?.assignedToUserId).toBe("o2");
    expect(r.data?.type).toBe("ALARM_RESPONSE");
    expect(r.data?.source).toBe("ALARM"); // defaulted from type
    expect(r.data?.priority).toBe("MEDIUM");
    expect(r.data?.scheduledFor).toBeNull();
    expect(r.summary).toContain("Shurgard Neasden");
    expect(r.summary).toContain("Jane Doe");
  });

  it("resolves a partner hand-off and defaults a non-alarm source", () => {
    const r = resolveCallout(
      {
        siteQuery: "Norbury",
        type: "LOCK",
        handlerKind: "partner",
        partnerName: "Nexus",
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.handlerKind).toBe("partner");
    expect(r.data?.handlerPartnerId).toBe("p1");
    expect(r.data?.source).toBe("CUSTOMER_REQUEST");
    expect(r.data?.assignedToUserId).toBeNull();
  });

  it("flags an unknown site", () => {
    const r = resolveCallout(
      {
        siteQuery: "Wembley",
        type: "ADHOC",
        handlerKind: "officer",
        officerName: "Jane",
      },
      CTX,
    );
    expect(r.ok).toBe(false);
    expect(r.data).toBeUndefined();
    expect(r.problems.some((p) => p.includes("Wembley"))).toBe(true);
  });

  it("flags an ambiguous officer", () => {
    const r = resolveCallout(
      {
        siteQuery: "Neasden",
        type: "ALARM_RESPONSE",
        handlerKind: "officer",
        officerName: "John",
      },
      CTX,
    );
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.toLowerCase().includes("several"))).toBe(
      true,
    );
  });

  it("asks who should attend when no officer is named", () => {
    const r = resolveCallout(
      { siteQuery: "Neasden", type: "ALARM_RESPONSE", handlerKind: "officer" },
      CTX,
    );
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.toLowerCase().includes("who"))).toBe(true);
  });

  it("parses a UK wall-clock scheduledFor into a Date", () => {
    const r = resolveCallout(
      {
        siteQuery: "Neasden",
        type: "ALARM_RESPONSE",
        handlerKind: "officer",
        officerName: "Jane",
        scheduledFor: "2026-07-25T21:00",
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.scheduledFor).toBeInstanceOf(Date);
    expect(Number.isNaN(r.data!.scheduledFor!.getTime())).toBe(false);
  });

  it("flags an unreadable time", () => {
    const r = resolveCallout(
      {
        siteQuery: "Neasden",
        type: "ALARM_RESPONSE",
        handlerKind: "officer",
        officerName: "Jane",
        scheduledFor: "tonight-ish",
      },
      CTX,
    );
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.toLowerCase().includes("time"))).toBe(true);
  });

  it("coerces an unknown type to ADHOC", () => {
    const r = resolveCallout(
      {
        siteQuery: "Neasden",
        type: "SOMETHING_ELSE",
        handlerKind: "officer",
        officerName: "Jane",
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.type).toBe("ADHOC");
  });
});

describe("callout callback_data", () => {
  it("round-trips a confirm action", () => {
    const data = calloutConfirmData("abc123");
    expect(data).toBe("coc:abc123");
    expect(decodeCalloutAction(data)).toEqual({
      action: "confirm",
      draftId: "abc123",
    });
  });

  it("round-trips a cancel action", () => {
    const data = calloutCancelData("xyz789");
    expect(data).toBe("cox:xyz789");
    expect(decodeCalloutAction(data)).toEqual({
      action: "cancel",
      draftId: "xyz789",
    });
  });

  it("preserves a UUID draft id with hyphens", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(decodeCalloutAction(calloutConfirmData(id))?.draftId).toBe(id);
  });

  it("returns null for unrelated data", () => {
    expect(decodeCalloutAction("garbage")).toBeNull();
    expect(decodeCalloutAction("")).toBeNull();
  });

  it("stays within Telegram's 64-byte callback_data limit", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(calloutConfirmData(id).length).toBeLessThanOrEqual(64);
  });
});

describe("job action callback_data", () => {
  const id = "00000000-0000-4000-8000-000000000009";

  it("round-trips on-site and complete", () => {
    expect(decodeJobAction(jobActionData("onsite", id))).toEqual({
      action: "onsite",
      jobId: id,
    });
    expect(decodeJobAction(jobActionData("complete", id))).toEqual({
      action: "complete",
      jobId: id,
    });
  });

  it("does not collide with callout actions", () => {
    expect(decodeJobAction(calloutConfirmData(id))).toBeNull();
    expect(decodeCalloutAction(jobActionData("onsite", id))).toBeNull();
  });

  it("returns null for unrelated data and stays within 64 bytes", () => {
    expect(decodeJobAction("nope")).toBeNull();
    expect(jobActionData("complete", id).length).toBeLessThanOrEqual(64);
  });
});
