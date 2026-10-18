import { describe, it, expect } from "vitest";
import {
  answerKind,
  extractFacts,
  parseFastFieldTime,
  pickActivity,
  pickOfficer,
  pickSite,
  splitSiaNumber,
  type ActivityCandidate,
  type FastFieldAnswer,
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

const site = (id: string, name: string, lat: number | null, lng: number | null, address = ""): SiteRow => ({
  id,
  name,
  code: null,
  postcode: null,
  address,
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
    const p = pickSite("Neasden", null, null, sites);
    expect(p.site?.id).toBe("neasden");
  });

  it("settles a name that fits several sites with GPS", () => {
    const p = pickSite("Acton", 51.5012, -0.2688, sites);
    expect(p.site?.id).toBe("acton2");
    expect(p.site && p.how).toBe("name+gps");
  });

  it("leaves an ambiguous name without GPS for a person", () => {
    const p = pickSite("Acton", null, null, sites);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/fits 2 sites/);
  });

  it("uses GPS alone when the name isn't recognised", () => {
    const p = pickSite("Nesden", 51.5533, -0.2504, sites);
    expect(p.site?.id).toBe("neasden");
    expect(p.site && p.how).toBe("gps");
  });

  it("gives up when neither the name nor GPS fit", () => {
    const p = pickSite("Croydon", 51.37, -0.10, sites);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/not recognised/);
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

  it("asks a person when the type preference only just tips it", () => {
    // Patrol 15 min away vs callout 35 min away (counts as 5): too close to call.
    const p = pickActivity(when, "ALARM_RESPONSE", [job("patrol", "PATROL", "21:00"), job("callout", "ALARM_RESPONSE", "20:40")]);
    expect(p.pick).toBeNull();
    expect(!p.pick && p.reason).toBe("ambiguous");
  });

  it("leaves two equally close activities for a person", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [job("a", "PATROL", "21:00"), job("b", "PATROL", "21:30")]);
    expect(p.pick).toBeNull();
    expect(!p.pick && p.reason).toBe("ambiguous");
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
