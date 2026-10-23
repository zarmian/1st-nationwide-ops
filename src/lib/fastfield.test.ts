import { describe, it, expect } from "vitest";
import {
  answerKind,
  apartText,
  extractFacts,
  extractPostcode,
  parseFastFieldTime,
  pickActivity,
  pickActivityWide,
  pickOfficer,
  pickShift,
  pickSite,
  pickSiteByActivity,
  shiftAround,
  splitSiaNumber,
  visitTypeOf,
  type ActivityCandidate,
  type FastFieldAnswer,
  type ShiftCandidate,
  type SiteRow,
} from "./fastfield";

// The Shurgard form as FastField sends it (answers in form order).
function shurgardAnswers(over: Partial<Record<string, unknown>> = {}): FastFieldAnswer[] {
  return [
    { key: "alpha_1", label: "Site Name", type: "SingleLineEntryAlpha", value: over.site ?? "Shurgard Neasden" },
    {
      key: "multiline_1",
      label: "Officer Name/SIA Number",
      type: "MultiLineEntry",
      value: over.officer ?? "Ahmed Khan 1234 5678 9012 3456",
    },
    {
      key: "datepicker_1",
      label: "Arrive Date/Time",
      type: "DatePicker",
      value: over.arrive ?? "2026-10-17T22:15:00.000+01:00",
      at: "2026-10-17T22:16:02.000+01:00",
      lat: 51.5531,
      lng: -0.2501,
    },
    { key: "tri_2", label: "Fire Services/Police Called? Yes/No", type: "ThreeState", value: 2 },
    {
      key: "multiline_2",
      label: "Issue/Observation/Incident Report",
      type: "MultiLineEntry",
      value: "Alarm activated by a fault on the rear shutter. Reset and secured.",
    },
    {
      key: "multiphoto_picker_1",
      label: "Photo Album",
      type: "MultiPhotoPicker",
      value: [{ url: "https://blob.example/a.jpg" }],
    },
    {
      key: "datepicker_2",
      label: "Signed Off Date/Time",
      type: "DatePicker",
      value: over.leave ?? "2026-10-17T22:50:00.000+01:00",
    },
    { key: "signature_1", label: "Signature", type: "SignatureCapture", value: { url: "https://blob.example/s.png" } },
    {
      key: "location_1",
      label: "Location / GPS",
      type: "LocationPicker",
      value: { latitude: 0, longitude: 0, formatted_address: "N/A" },
    },
  ];
}

const SUBMITTED = "2026-10-17T22:55:00.000+01:00";

describe("answerKind", () => {
  it("sorts FastField field types", () => {
    expect(answerKind("DatePicker")).toBe("date");
    expect(answerKind("TimePicker")).toBe("date");
    expect(answerKind("LocationPicker")).toBe("location");
    expect(answerKind("MultiPhotoPicker")).toBe("photo");
    expect(answerKind("SignatureCapture")).toBe("signature");
    expect(answerKind("ThreeState")).toBe("tri");
    expect(answerKind("SingleLineEntryAlpha")).toBe("text");
    expect(answerKind("MultiLineEntry")).toBe("text");
    expect(answerKind("ListPicker")).toBe("text");
    expect(answerKind("Timer")).toBe("other");
  });
});

describe("parseFastFieldTime", () => {
  it("reads ISO times with an offset", () => {
    expect(parseFastFieldTime("2026-10-17T22:15:00.000+01:00")?.toISOString()).toBe(
      "2026-10-17T21:15:00.000Z",
    );
  });
  it("reads a time without a zone as UK wall-clock", () => {
    // 17 Oct 2026 is BST (UTC+1).
    expect(parseFastFieldTime("2026-10-17T22:15:00.000")?.toISOString()).toBe(
      "2026-10-17T21:15:00.000Z",
    );
    // 1 Dec is GMT.
    expect(parseFastFieldTime("2026-12-01T08:00")?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });
  it("ignores dates without a time, and junk", () => {
    expect(parseFastFieldTime("17-10-2026")).toBeNull();
    expect(parseFastFieldTime("2026-10-17")).toBeNull();
    expect(parseFastFieldTime("")).toBeNull();
    expect(parseFastFieldTime(42)).toBeNull();
  });
});

describe("splitSiaNumber", () => {
  it("separates a 16-digit SIA number from the name", () => {
    expect(splitSiaNumber("Ahmed Khan 1234 5678 9012 3456")).toEqual({
      name: "Ahmed Khan",
      sia: "1234567890123456",
    });
    expect(splitSiaNumber("Ahmed Khan / SIA No: 1234-5678-9012-3456")).toEqual({
      name: "Ahmed Khan",
      sia: "1234567890123456",
    });
  });
  it("leaves a plain name alone", () => {
    expect(splitSiaNumber("Ahmed")).toEqual({ name: "Ahmed", sia: null });
  });
});

describe("extractFacts", () => {
  it("reads the Shurgard form", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      startedAt: "2026-10-17T22:14:00.000+01:00",
      finishedAt: "2026-10-17T22:54:00.000+01:00",
      answers: shurgardAnswers(),
    });
    expect(f.siteText).toBe("Shurgard Neasden");
    expect(f.officerText).toBe("Ahmed Khan 1234 5678 9012 3456");
    expect(f.officerName).toBe("Ahmed Khan");
    expect(f.siaNumber).toBe("1234567890123456");
    expect(f.arrivedAt?.toISOString()).toBe("2026-10-17T21:15:00.000Z");
    expect(f.departedAt?.toISOString()).toBe("2026-10-17T21:50:00.000Z");
    expect(f.when.toISOString()).toBe("2026-10-17T21:15:00.000Z");
    // The location field was blank (0,0) — the arrival field's GPS stands in.
    expect(f.lat).toBeCloseTo(51.5531);
    expect(f.lng).toBeCloseTo(-0.2501);
    expect(f.summary).toMatch(/^Alarm activated/);
  });

  it("prefers a real location answer for GPS", () => {
    const answers = shurgardAnswers();
    answers[8] = { ...answers[8], value: { latitude: 51.6, longitude: -0.3 } };
    const f = extractFacts({ submittedAt: SUBMITTED, answers });
    expect(f.lat).toBe(51.6);
    expect(f.lng).toBe(-0.3);
  });

  it("ignores a typed time far from the submission", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      startedAt: "2026-10-17T22:10:00.000+01:00",
      answers: shurgardAnswers({ arrive: "2025-01-01T09:00:00.000+00:00" }),
    });
    expect(f.arrivedAt).toBeNull();
    expect(f.when.toISOString()).toBe("2026-10-17T21:10:00.000Z"); // form opened
  });

  it("drops a departure before the arrival", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      answers: shurgardAnswers({ leave: "2026-10-17T21:00:00.000+01:00" }),
    });
    expect(f.departedAt).toBeNull();
  });

  it("falls back to the submission time", () => {
    const f = extractFacts({ submittedAt: SUBMITTED, answers: [] });
    expect(f.when.toISOString()).toBe("2026-10-17T21:55:00.000Z");
    expect(f.siteText).toBeNull();
    expect(f.officerText).toBeNull();
  });

  it("uses a bare name field for the officer, never a customer's name", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      answers: [
        { key: "a", label: "Customer name and unit number (if stuck on site)", type: "SingleLineEntry", value: "J Bloggs unit 4" },
        { key: "b", label: "Your Name", type: "SingleLineEntry", value: "Sam Taylor" },
        { key: "c", label: "Premises", type: "SingleLineEntry", value: "Acton" },
      ],
    });
    expect(f.officerText).toBe("Sam Taylor");
    expect(f.siteText).toBe("Acton");
  });

  it("treats two unlabelled visit times as arrival and departure, but not an incident time", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      answers: [
        { key: "d0", label: "Time of incident", type: "DatePicker", value: "2026-10-17T20:00:00.000+01:00" },
        { key: "d1", label: "Time 1", type: "DatePicker", value: "2026-10-17T22:00:00.000+01:00" },
        { key: "d2", label: "Time 2", type: "DatePicker", value: "2026-10-17T22:30:00.000+01:00" },
      ],
    });
    expect(f.arrivedAt?.toISOString()).toBe("2026-10-17T21:00:00.000Z");
    expect(f.departedAt?.toISOString()).toBe("2026-10-17T21:30:00.000Z");
  });
});

const site = (
  id: string,
  name: string,
  lat: number | null,
  lng: number | null,
  address = "",
  postcode: string | null = null,
): SiteRow => ({
  id,
  name,
  code: null,
  postcode,
  address,
  lat,
  lng,
});

const at = (siteText: string | null, lat: number | null = null, lng: number | null = null) => ({
  siteText,
  postcode: extractPostcode(siteText),
  lat,
  lng,
});

describe("pickSite", () => {
  const sites = [
    site("neasden", "Shurgard Neasden", 51.5531, -0.2501, "Neasden Lane London"),
    site("wembley", "Shurgard Wembley", 51.5520, -0.2960, "Wembley London"),
    site("acton1", "Shurgard Acton North", 51.5150, -0.2700, "Acton London"),
    site("acton2", "Shurgard Acton South", 51.5010, -0.2690, "Acton London"),
  ];

  it("matches the site by name", () => {
    const p = pickSite(at("Neasden"), sites);
    expect(p.site?.id).toBe("neasden");
  });

  it("settles a name that fits several sites with GPS", () => {
    const p = pickSite(at("Acton", 51.5012, -0.2688), sites);
    expect(p.site?.id).toBe("acton2");
    expect(p.site && p.how).toBe("name+gps");
  });

  it("leaves an ambiguous name without GPS undecided, with the sites it fits", () => {
    const p = pickSite(at("Acton"), sites);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/fits 2 sites/);
    expect(!p.site && p.candidates.map((c) => c.id).sort()).toEqual(["acton1", "acton2"]);
  });

  it("offers the sites near the GPS fix when the name isn't recognised", () => {
    // ~1.1 km from Acton North: too far for GPS alone, near enough to offer.
    const p = pickSite(at("Unit 4", 51.525, -0.27), sites);
    expect(p.site).toBeNull();
    expect(!p.site && p.candidates.map((c) => c.id)).toEqual(["acton1"]);
  });

  it("uses GPS alone when the name isn't recognised", () => {
    const p = pickSite(at("Nesden", 51.5533, -0.2504), sites);
    expect(p.site?.id).toBe("neasden");
    expect(p.site && p.how).toBe("gps");
  });

  it("gives up when neither the name nor GPS fit", () => {
    const p = pickSite(at("Croydon", 51.37, -0.1), sites);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/not recognised/);
  });
});

describe("pickSite by postcode", () => {
  const sites = [
    site("neasden", "Shurgard Neasden", 51.5531, -0.2501, "Neasden Lane London", "NW10 7UD"),
    site("reay", "Reay Security — Park Royal", 51.528, -0.27, "Park Royal", "NW10 7UD"),
    site("acton", "Shurgard Acton", 51.515, -0.27, "Acton London", "W3 6UU"),
    site("lewisham", "Europcar Lewisham", 51.46, -0.01, "Lewisham", "SE13 5PL"),
  ];

  it("finds a postcode typed in the site name", () => {
    expect(extractPostcode("Shurgard w3 6uu")).toBe("W36UU");
    expect(extractPostcode("SE135PL")).toBe("SE135PL");
    expect(extractPostcode("Unit 4, Acton")).toBeNull();
    const p = pickSite(at("Shurgard W3 6UU"), sites);
    expect(p.site?.id).toBe("acton");
    expect(p.site && p.how).toBe("postcode");
  });

  it("works when the site name is only a postcode", () => {
    expect(pickSite(at("se13 5pl"), sites).site?.id).toBe("lewisham");
  });

  it("uses the name when two sites share the postcode", () => {
    const p = pickSite(at("Neasden NW10 7UD"), sites);
    expect(p.site?.id).toBe("neasden");
    expect(p.site && p.how).toBe("postcode+name");
  });

  it("asks a person when two sites share the postcode and nothing else tells them apart", () => {
    const p = pickSite(at("NW10 7UD"), sites);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/Postcode NW107UD fits 2 sites/);
  });

  it("falls back to the name when the postcode isn't one of ours", () => {
    expect(pickSite(at("Lewisham E1 6AN"), sites).site?.id).toBe("lewisham");
  });

  it("reads the postcode from a postcode answer when the site name has none", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      answers: [
        { key: "a", label: "Site Name", type: "SingleLineEntry", value: "Shurgard" },
        { key: "b", label: "Site Postcode", type: "SingleLineEntry", value: "w3 6uu" },
      ],
    });
    expect(f.postcode).toBe("W36UU");
    expect(pickSite(f, sites).site?.id).toBe("acton");
  });
});

describe("visitTypeOf", () => {
  const ans = (label: string, value: string): FastFieldAnswer => ({
    key: "k",
    label,
    type: "ListPicker",
    value,
  });
  it("reads the kind of visit from a short type answer", () => {
    expect(visitTypeOf([ans("Visit Type", "Lock up")])).toBe("LOCK");
    expect(visitTypeOf([ans("Type of attendance", "Unlock")])).toBe("UNLOCK");
    expect(visitTypeOf([ans("Reason for visit", "Alarm activation")])).toBe("ALARM_RESPONSE");
    expect(visitTypeOf([ans("Job type", "Mobile patrol")])).toBe("PATROL");
  });
  it("ignores long notes and unrelated questions", () => {
    expect(
      visitTypeOf([ans("Call-out reason", "Gate was left unlocked by a customer and the alarm went off at 22:00")]),
    ).toBeNull();
    expect(visitTypeOf([ans("Site Name", "Lock-up Storage Ltd")])).toBeNull();
  });
});

describe("pickShift", () => {
  const when = new Date("2026-10-17T21:15:00.000Z");
  const shift = (id: string, start: string, end: string, officerId: string | null = null): ShiftCandidate => ({
    id,
    start: new Date(`2026-10-17T${start}:00.000Z`),
    end: new Date(`2026-10-${end > start ? "17" : "18"}T${end}:00.000Z`),
    officerId,
  });

  it("finds the shift on at the time", () => {
    const p = pickShift(when, [shift("day", "07:00", "19:00"), shift("night", "19:00", "07:00")], null);
    expect(p.pick?.id).toBe("night");
  });

  it("counts a report just before the start or after the end", () => {
    expect(pickShift(new Date("2026-10-17T18:40:00.000Z"), [shift("night", "19:00", "07:00")], null).pick?.id).toBe(
      "night",
    );
    expect(pickShift(new Date("2026-10-17T19:50:00.000Z"), [shift("day", "07:00", "19:00")], null).pick?.id).toBe(
      "day",
    );
    expect(pickShift(new Date("2026-10-17T20:30:00.000Z"), [shift("day", "07:00", "19:00")], null).pick).toBeNull();
  });

  it("picks the officer's own shift when two were on", () => {
    const both = [shift("a", "19:00", "07:00", "u1"), shift("b", "19:00", "07:00", "u2")];
    const p = pickShift(when, both, "u2");
    expect(p.pick?.id).toBe("b");
    expect(p.pick && p.shared).toBe(false);
  });

  it("takes the one that started first when the officer doesn't settle it", () => {
    const both = [shift("late", "20:00", "08:00"), shift("early", "18:00", "06:00")];
    const p = pickShift(when, both, null);
    expect(p.pick?.id).toBe("early");
    expect(p.pick && p.shared).toBe(true);
    const same = [shift("b", "19:00", "07:00"), shift("a", "19:00", "07:00")];
    expect(pickShift(when, same, null).pick?.id).toBe("a");
  });
});

describe("shiftAround", () => {
  const shift = (id: string, start: string, end: string): ShiftCandidate => ({
    id,
    start: new Date(start),
    end: new Date(end),
    officerId: null,
  });
  const night = shift("night", "2026-10-17T18:00:00Z", "2026-10-18T07:00:00Z");

  it("takes a patrol round sent in up to 6 hours after the shift ended", () => {
    const p = shiftAround(new Date("2026-10-18T11:30:00Z"), [night]);
    expect(p?.pick.id).toBe("night");
    expect(p?.after).toBe(true);
    expect(p?.gapMin).toBe(270);
    expect(shiftAround(new Date("2026-10-18T13:30:00Z"), [night])).toBeNull();
  });

  it("takes one up to 2 hours before it started", () => {
    const p = shiftAround(new Date("2026-10-17T16:30:00Z"), [night]);
    expect(p?.pick.id).toBe("night");
    expect(p?.after).toBe(false);
    expect(shiftAround(new Date("2026-10-17T15:30:00Z"), [night])).toBeNull();
  });

  it("takes the nearer of two shifts", () => {
    const next = shift("next", "2026-10-18T18:00:00Z", "2026-10-19T07:00:00Z");
    expect(shiftAround(new Date("2026-10-18T09:00:00Z"), [next, night])?.pick.id).toBe("night");
    expect(shiftAround(new Date("2026-10-18T16:30:00Z"), [next, night])?.pick.id).toBe("next");
  });
});

describe("pickSiteByActivity", () => {
  const a = site("a", "Shurgard Acton North", 51.515, -0.27, "Acton London");
  const b = site("b", "Shurgard Acton South", 51.501, -0.269, "Acton London");
  const far = site("far", "Shurgard Croydon", 51.37, -0.1, "Croydon");

  it("takes the one site that had work on", () => {
    expect(pickSiteByActivity({ lat: null, lng: null }, [a, b], new Set(["b"]))?.id).toBe("b");
  });
  it("won't guess when none, or more than one, had work on", () => {
    expect(pickSiteByActivity({ lat: null, lng: null }, [a, b], new Set())).toBeNull();
    expect(pickSiteByActivity({ lat: null, lng: null }, [a, b], new Set(["a", "b"]))).toBeNull();
  });
  it("won't take a site far from the phone's GPS fix", () => {
    expect(pickSiteByActivity({ lat: 51.515, lng: -0.27 }, [a, far], new Set(["far"]))).toBeNull();
    expect(pickSiteByActivity({ lat: 51.514, lng: -0.271 }, [a, far], new Set(["a"]))?.id).toBe("a");
  });
});

describe("pickOfficer", () => {
  const people = [
    { id: "u1", name: "Ahmed Khan", siaNumber: "1234 5678 9012 3456" },
    { id: "u2", name: "Ahmed Ali", siaNumber: null },
    { id: "u3", name: "Sam Taylor", siaNumber: null },
  ];
  const facts = (officerText: string) =>
    extractFacts({
      submittedAt: SUBMITTED,
      answers: [{ key: "o", label: "Officer Name/SIA Number", type: "SingleLineEntry", value: officerText }],
    });

  it("matches by SIA number first", () => {
    expect(pickOfficer(facts("A Khan 1234567890123456"), people)).toBe("u1");
  });
  it("matches by name", () => {
    expect(pickOfficer(facts("Sam Taylor"), people)).toBe("u3");
    expect(pickOfficer(facts("sam"), people)).toBe("u3");
  });
  it("won't guess between two people", () => {
    expect(pickOfficer(facts("Ahmed"), people)).toBeNull();
  });
});

describe("pickActivity", () => {
  const when = new Date("2026-10-17T21:15:00.000Z");
  const at = (hhmm: string) => new Date(`2026-10-17T${hhmm}:00.000Z`);
  const job = (id: string, type: string, time: string, taken = false): ActivityCandidate => ({
    kind: "job",
    id,
    type,
    times: [at(time)],
    taken,
  });

  it("picks the nearest activity", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [job("lock", "LOCK", "21:05"), job("unlock", "UNLOCK", "07:00")]);
    expect(p.pick?.id).toBe("lock");
    expect(p.pick && p.minutesApart).toBe(10);
  });

  it("prefers the form's own type", () => {
    // Patrol 15 min away vs callout 25 min away (counts as −5): callout wins
    // by 20 minutes, a clear margin.
    const p = pickActivity(when, "ALARM_RESPONSE", [job("patrol", "PATROL", "21:00"), job("callout", "ALARM_RESPONSE", "20:50")]);
    expect(p.pick?.id).toBe("callout");
  });

  it("takes the form's own type when two are about as close", () => {
    // Patrol 15 min away vs callout 35 min away (counts as 5): a close call,
    // settled by the kind of work.
    const p = pickActivity(when, "ALARM_RESPONSE", [job("patrol", "PATROL", "21:00"), job("callout", "ALARM_RESPONSE", "20:40")]);
    expect(p.pick?.id).toBe("callout");
    expect(p.pick && p.closeCall).toBe(true);
  });

  it("takes the nearer, then the earlier, when two are equally close", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [job("b", "PATROL", "21:30"), job("a", "PATROL", "21:00")]);
    expect(p.pick?.id).toBe("a");
    expect(p.pick && p.closeCall).toBe(true);
    const q = pickActivity(when, "ALARM_RESPONSE", [job("far", "PATROL", "20:40"), job("near", "PATROL", "21:05")]);
    expect(q.pick?.id).toBe("near");
  });

  it("isn't a close call when one is clearly nearer", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [job("a", "ALARM_RESPONSE", "21:10"), job("b", "ALARM_RESPONSE", "20:00")]);
    expect(p.pick?.id).toBe("a");
    expect(p.pick && p.closeCall).toBe(false);
  });

  it("says when the only nearby activity is taken", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [job("a", "ALARM_RESPONSE", "21:00", true)]);
    expect(!p.pick && p.reason).toBe("taken");
  });

  it("ignores activities more than 3 hours away", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [job("far", "ALARM_RESPONSE", "17:00")]);
    expect(!p.pick && p.reason).toBe("none");
  });

  it("uses whichever of an activity's times is closest", () => {
    const c: ActivityCandidate = {
      kind: "visit",
      id: "v",
      type: "PATROL",
      times: [at("17:30"), at("21:10")], // scheduled early, arrived late
      taken: false,
    };
    const p = pickActivity(when, "ALARM_RESPONSE", [c]);
    expect(p.pick?.id).toBe("v");
    expect(p.pick && p.minutesApart).toBe(5);
  });
});

describe("pickActivityWide", () => {
  // A report at 02:00 with nothing within 3 hours; the import runs at 09:00.
  const when = new Date("2026-10-18T02:00:00.000Z");
  const now = new Date("2026-10-18T09:00:00.000Z");
  const at = (iso: string) => new Date(`2026-10-${iso}:00.000Z`);
  const job = (id: string, type: string, time: string, taken = false): ActivityCandidate => ({
    kind: "job",
    id,
    type,
    times: [at(time)],
    taken,
  });

  it("matches the same kind of work up to 18 hours away", () => {
    const p = pickActivityWide(when, "ALARM_RESPONSE", [job("callout", "ALARM_RESPONSE", "17T20:00")], now);
    expect(p.pick?.id).toBe("callout");
    expect(p.pick && p.minutesApart).toBe(360);
  });

  it("counts similar job types as the same kind", () => {
    expect(pickActivityWide(when, "ALARM_RESPONSE", [job("adhoc", "ADHOC", "17T20:00")], now).pick?.id).toBe("adhoc");
    expect(pickActivityWide(when, "PATROL", [job("vpi", "VPI", "17T22:00")], now).pick?.id).toBe("vpi");
  });

  it("won't match a different kind of work", () => {
    const p = pickActivityWide(when, "ALARM_RESPONSE", [job("lock", "LOCK", "17T21:00"), job("unlock", "UNLOCK", "18T07:00")], now);
    expect(!p.pick && p.reason).toBe("none");
    expect(pickActivityWide(when, "LOCK", [job("unlock", "UNLOCK", "18T07:00")], now).pick).toBeNull();
  });

  it("skips activities that already have a report", () => {
    const p = pickActivityWide(when, "ALARM_RESPONSE", [job("done", "ALARM_RESPONSE", "17T20:00", true)], now);
    expect(!p.pick && p.reason).toBe("none");
  });

  it("skips activities that aren't due yet", () => {
    // Tonight's patrol at 19:00 — after the import runs at 09:00.
    const p = pickActivityWide(when, "PATROL", [job("tonight", "PATROL", "18T19:00")], now);
    expect(!p.pick && p.reason).toBe("none");
    // A job logged later the same morning is due, so it counts.
    expect(pickActivityWide(when, "ALARM_RESPONSE", [job("logged", "ALARM_RESPONSE", "18T08:30")], now).pick?.id).toBe("logged");
  });

  it("ignores activities more than 18 hours away", () => {
    const p = pickActivityWide(when, "ALARM_RESPONSE", [job("old", "ALARM_RESPONSE", "17T07:00")], now);
    expect(!p.pick && p.reason).toBe("none");
  });

  it("takes the nearer of two about equally close", () => {
    const p = pickActivityWide(
      when,
      "LOCK",
      [job("b", "LOCK", "18T08:10"), job("a", "LOCK", "17T20:00")],
      new Date("2026-10-18T09:00:00.000Z"),
    );
    expect(p.pick?.id).toBe("a");
    expect(p.pick && p.closeCall).toBe(true);
  });

  it("takes the nearest when one is clearly closer", () => {
    const p = pickActivityWide(when, "LOCK", [job("near", "LOCK", "17T21:00"), job("far", "LOCK", "18T08:30")], now);
    expect(p.pick?.id).toBe("near");
  });

  it("does nothing for a kind it doesn't know", () => {
    expect(pickActivityWide(when, "OTHER", [job("x", "OTHER", "17T20:00")], now).pick).toBeNull();
  });
});

describe("apartText", () => {
  it("says minutes, then hours and minutes", () => {
    expect(apartText(45)).toBe("45 min");
    expect(apartText(360)).toBe("6 h");
    expect(apartText(310)).toBe("5 h 10 min");
  });
});
