import { describe, it, expect } from "vitest";
import {
  answerKind,
  apartText,
  extractFacts,
  extractPostcode,
  groupByPlace,
  parseFastFieldTime,
  pickActivity,
  pickActivityWide,
  pickOfficer,
  pickShift,
  pickSite,
  pickSiteByActivity,
  narrowSiteText,
  outsideShiftText,
  reportSpan,
  shiftApartMin,
  shiftFit,
  shiftHoursText,
  shiftLinkAction,
  siteKey,
  spanText,
  splitSiaNumber,
  visitTypeOf,
  type ActivityCandidate,
  type FastFieldAnswer,
  type ShiftCandidate,
  type SiteRow,
} from "./fastfield";
import { answerTime, timeRole, typedValue, withTimesNote, type TimeRole } from "./fastfield";

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
  it.each([
    // A space before the time, with an offset (review L10).
    ["2026-10-17 22:15:00+01:00", "2026-10-17T21:15:00.000Z"],
    ["2026-10-17T22:15:00.123+01:00", "2026-10-17T21:15:00.123Z"],
    ["2026-10-17T22:15+0100", "2026-10-17T21:15:00.000Z"],
    ["2026-10-17T22:15:00Z", "2026-10-17T22:15:00.000Z"],
    // No zone: UK time, 12-hour clock too, and UK day-first dates.
    ["2026-10-17 10:15 pm", "2026-10-17T21:15:00.000Z"],
    ["17/10/2026 22:15", "2026-10-17T21:15:00.000Z"],
    ["01/12/2026 08:00", "2026-12-01T08:00:00.000Z"],
    // The nights the clocks change: 01:30 on 29 Mar 2026 doesn't exist (read
    // with the summer offset); on 25 Oct 2026 it happens twice (the GMT one).
    ["2026-03-29T01:30", "2026-03-29T00:30:00.000Z"],
    ["2026-10-25T01:30", "2026-10-25T01:30:00.000Z"],
  ])("reads %s", (value, iso) => {
    expect(parseFastFieldTime(value)?.toISOString()).toBe(iso);
  });
  it("needs a real date and time", () => {
    expect(parseFastFieldTime("2026-02-30T10:00")).toBeNull();
    expect(parseFastFieldTime("2026-10-17T25:00")).toBeNull();
    expect(parseFastFieldTime("06:20")).toBeNull();
    expect(parseFastFieldTime("17/10/2026")).toBeNull();
  });
});

describe("typedValue", () => {
  const v = (label: string, value: unknown) => typedValue({ label, value });
  const moment = (iso: string) => ({ kind: "moment", at: new Date(iso) });
  const time = (h: number, mi: number, s = 0) => ({ kind: "time", h, mi, s, ms: 0 });
  const date = (year: number, month: number, day: number) => ({ kind: "date", day: { year, month, day } });

  it.each([
    ["Arrive Date/Time", "2026-10-17T22:15:00.000+01:00", moment("2026-10-17T21:15:00.000Z")],
    ["Arrive Date/Time", "2026-11-24T06:20", moment("2026-11-24T06:20:00.000Z")],
    // A time picker: a time of day, whatever form it comes in.
    ["Arrival time", "06:20", time(6, 20)],
    ["Arrival time", "06:20:45", time(6, 20, 45)],
    ["Arrival time", "6:20 PM", time(18, 20)],
    ["Arrival time", "12:05 am", time(0, 5)],
    ["Arrival time", "1900-01-01T06:20:00", time(6, 20)],
    ["Arrival time", "1970-01-01T06:20:00.000Z", time(6, 20)],
    // A date picker: a day.
    ["Date", "2026-11-24", date(2026, 11, 24)],
    ["Patrol date", "24/11/2026", date(2026, 11, 24)],
    // …also when it keeps the day as midnight, under a label asking for a date.
    ["Date of patrol", "2026-11-24T00:00:00.000Z", date(2026, 11, 24)],
    ["Date of patrol", "2026-06-23T23:00:00.000Z", date(2026, 6, 24)], // UK midnight (BST)
    // Midnight under a label asking for a time is a time.
    ["Date/Time", "2026-11-24T00:00:00.000Z", moment("2026-11-24T00:00:00.000Z")],
  ])("%s = %s", (label, value, want) => {
    expect(v(label, value)).toEqual(want);
  });

  it("is null for anything else", () => {
    expect(v("Arrival time", "25:00")).toBeNull();
    expect(v("Arrival time", "13:00 pm")).toBeNull();
    expect(v("Arrival time", "soon")).toBeNull();
    expect(v("Arrival time", 42)).toBeNull();
    expect(v("Arrival time", { value: "06:20" })).toBeNull();
    expect(v("Arrival time", null)).toBeNull();
  });
});

describe("answerTime", () => {
  const ans = (value: unknown, at: string | null = "2026-11-24T07:45:10.000Z"): FastFieldAnswer => ({
    key: "t",
    label: "Arrival Time",
    type: "TimePicker",
    value,
    at,
  });
  const sent = new Date("2026-11-24T07:50:00.000Z");

  it("never uses when the field was tapped on the phone (review H2)", () => {
    expect(answerTime(ans("06:20"), { submittedAt: sent })?.toISOString()).toBe("2026-11-24T06:20:00.000Z");
    expect(answerTime(ans("2026-11-24"), { submittedAt: sent })).toBeNull();
    expect(answerTime(ans("not a time"), { submittedAt: sent })).toBeNull();
    expect(answerTime(ans(null), { submittedAt: sent })).toBeNull();
  });

  it("puts a time typed on its own on the date typed in the form", () => {
    const day = { year: 2026, month: 11, day: 22 };
    expect(answerTime(ans("23:10"), { submittedAt: sent, day })?.toISOString()).toBe("2026-11-22T23:10:00.000Z");
  });

  it("else on the day it was sent — the day before if that's more than 15 minutes after it was sent", () => {
    const at = (value: string, submitted: string) =>
      answerTime(ans(value), { submittedAt: new Date(submitted) })?.toISOString();
    expect(at("23:50", "2026-11-25T00:15:00.000Z")).toBe("2026-11-24T23:50:00.000Z");
    expect(at("00:25", "2026-11-25T00:15:00.000Z")).toBe("2026-11-25T00:25:00.000Z"); // 10 min after: kept
    expect(at("00:40", "2026-11-25T00:15:00.000Z")).toBe("2026-11-24T00:40:00.000Z"); // 25 min after
    // UK days and UK time in summer: sent 07:00 BST.
    expect(at("06:20", "2026-06-24T06:00:00.000Z")).toBe("2026-06-24T05:20:00.000Z");
    expect(at("23:30", "2026-06-24T23:10:00.000Z")).toBe("2026-06-24T22:30:00.000Z"); // 00:10 BST on the 25th
  });

  it("can't place a time on its own without a day to put it on", () => {
    expect(answerTime(ans("06:20"))).toBeNull();
    expect(answerTime(ans("2026-11-24T06:20:00.000Z"))?.toISOString()).toBe("2026-11-24T06:20:00.000Z");
  });
});

describe("timeRole", () => {
  const cases: [TimeRole, string[]][] = [
    [
      "arrive",
      [
        "Arrive Date/Time",
        "Arrival time",
        "Time on site",
        "Onsite",
        "Time attended",
        "Reached site",
        "Signed on",
        "Signed On Date/Time",
        "Booked on",
        "Clocked in",
        "Clock in",
        "Clock on",
        "Logged in",
        "Check in",
        "Time on",
        "Time in",
        "On duty",
        "Start of patrol",
        "Patrol start time",
        // The officer's own times at an alarm, an incident or a callout (review M1).
        "Arrived at alarm",
        "Arrived at fire alarm",
        "Fire alarm callout — time on site",
        "Callout arrival time",
        "Callout start time",
        "Emergency callout arrival",
        "Time attended (alarm response)",
        "Call attended",
        "Alarm response start time",
        "Time attended incident",
        "Arrived at incident",
        // A client's or customer's place is where the officer was.
        "Arrival at customer site",
        "Time arrived at client premises",
        "Customer's site — time on site",
        "Customer’s site — time on site",
        "Customers' site — time on site",
      ],
    ],
    [
      "leave",
      [
        "Departure time",
        "Time left site",
        "Left site",
        "Time Left",
        "Signed Off Date/Time",
        "Signed off",
        "Booked off",
        "Clocked out",
        "Clock out",
        "Logged out",
        "Check out",
        "Time off",
        "Time out",
        "Off duty",
        "End of patrol",
        "Patrol finish time",
        "Completed",
        "Time left alarm site",
        "Callout finish time",
        "Alarm callout finish time",
        "Left customer premises",
      ],
    ],
    [
      "plain",
      [
        "Date/Time",
        "Date/Time of patrol",
        "Time 1",
        "Lock up time",
        "Response time",
        "Alarm response time",
        // Both words: it doesn't say which.
        "Start/Finish",
        "Time on/off site",
      ],
    ],
    [
      "not",
      [
        // Someone else's time, even with an arrival or leaving word.
        "Time police attended",
        "Police arrived",
        "Police arrival time",
        "Fire brigade left",
        "Fire brigade attended",
        "Fire service arrived",
        "Fire crew on site",
        "Firefighters arrived",
        "Fire and rescue left",
        "Emergency services arrived",
        "Ambulance arrived",
        "Keyholder arrived",
        "Key holder on site",
        "Engineer on site",
        "Engineer finished",
        "Customer arrived",
        "Customers left",
        "Customer arrival time",
        "Time customer called",
        "Client left",
        "Client contacted at",
        "Manager attended",
        "Contractor finished",
        // An event's time.
        "Incident start time",
        "Time of incident",
        "Incident time",
        "Alarm activation time",
        "Time alarm activated",
        "Time triggered",
        "Alert received",
        "Time reported",
        "Call received",
        "Time of call",
        "Time of callout",
        "Time of call out",
        "Time called",
        "Called out at",
        "Call time",
        "Time alarm turned off",
        "Alarm time",
        "Alarm end time",
        "Call out time",
      ],
    ],
  ];
  for (const [role, labels] of cases) {
    it.each(labels)(`"%s" is ${role}`, (label) => {
      expect(timeRole(label)).toBe(role);
    });
  }
});

describe("extractFacts: the report's typed times", () => {
  // 24 Nov 2026 is GMT, so UK times read the same as UTC.
  const t = (label: string, value: unknown, extra: Partial<FastFieldAnswer> = {}): FastFieldAnswer => ({
    key: label,
    label,
    type: "DatePicker",
    value,
    ...extra,
  });
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  const span = (f: ReturnType<typeof extractFacts>) => {
    const s = reportSpan(f);
    return [s.from.toISOString(), s.to.toISOString()];
  };
  const night: ShiftCandidate = {
    id: "night",
    start: new Date("2026-11-23T19:00:00Z"),
    end: new Date("2026-11-24T07:00:00Z"),
    officerId: null,
  };
  const day: ShiftCandidate = {
    id: "day",
    start: new Date("2026-11-24T07:00:00Z"),
    end: new Date("2026-11-24T19:00:00Z"),
    officerId: null,
  };

  it("takes one plain typed time as the report's moment (review H1)", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T07:50:00Z",
      startedAt: "2026-11-24T06:30:00Z",
      answers: [t("Date/Time of patrol", "2026-11-24T06:35:00.000Z")],
    });
    expect(iso(f.arrivedAt)).toBe("2026-11-24T06:35:00.000Z");
    expect(f.departedAt).toBeNull();
    expect(span(f)).toEqual(["2026-11-24T06:35:00.000Z", "2026-11-24T06:35:00.000Z"]);
    // It's the night shift's round: the robot neither puts it on the day
    // shift nor moves it there, as it did when 07:50 (sent) was its time.
    expect(pickShift(reportSpan(f), [night, day], null).pick?.id).toBe("night");
    expect(shiftLinkAction(reportSpan(f), night, [night, day], null)).toEqual({ kind: "fit" });
  });

  it("fills a missing side from the plain times, earliest first and latest last (H1, L6)", () => {
    const sent = "2026-11-24T07:50:00Z";
    const leftOnly = extractFacts({
      submittedAt: sent,
      answers: [t("Time Left", "2026-11-24T06:40:00Z"), t("Date/Time", "2026-11-24T06:20:00Z")],
    });
    expect(span(leftOnly)).toEqual(["2026-11-24T06:20:00.000Z", "2026-11-24T06:40:00.000Z"]);
    // Out of order on the form: still the earliest to the latest.
    const unordered = extractFacts({
      submittedAt: sent,
      answers: [t("Time 1", "2026-11-24T06:40:00Z"), t("Time 2", "2026-11-24T06:20:00Z"), t("Time 3", "2026-11-24T06:30:00Z")],
    });
    expect(span(unordered)).toEqual(["2026-11-24T06:20:00.000Z", "2026-11-24T06:40:00.000Z"]);
    // A labelled arrival, and a plain time after it: that's the departure.
    const arrivalOnly = extractFacts({
      submittedAt: sent,
      answers: [t("Arrival time", "2026-11-24T06:00:00Z"), t("Time", "2026-11-24T06:45:00Z")],
    });
    expect(span(arrivalOnly)).toEqual(["2026-11-24T06:00:00.000Z", "2026-11-24T06:45:00.000Z"]);
  });

  it("lets labelled times win for their side, and only fills a side a plain time fits", () => {
    const sent = "2026-11-24T07:50:00Z";
    // A plain time before the labelled arrival is neither arrival nor departure.
    const f = extractFacts({
      submittedAt: sent,
      answers: [t("Time", "2026-11-24T06:05:00Z"), t("Arrival time", "2026-11-24T06:15:00Z")],
    });
    expect(iso(f.arrivedAt)).toBe("2026-11-24T06:15:00.000Z");
    expect(f.departedAt).toBeNull();
    // A plain time after the labelled departure doesn't become the arrival.
    const g = extractFacts({
      submittedAt: sent,
      answers: [t("Time left site", "2026-11-24T06:30:00Z"), t("Time", "2026-11-24T06:50:00Z")],
    });
    expect(g.arrivedAt).toBeNull();
    expect(span(g)).toEqual(["2026-11-24T06:30:00.000Z", "2026-11-24T06:30:00.000Z"]);
    // Two labelled arrivals: the earliest. Two departures: the latest.
    const h = extractFacts({
      submittedAt: sent,
      answers: [
        t("Signed on", "2026-11-24T06:10:00Z"),
        t("Arrival time", "2026-11-24T06:05:00Z"),
        t("Time left site", "2026-11-24T06:40:00Z"),
        t("Signed off", "2026-11-24T06:45:00Z"),
      ],
    });
    expect(span(h)).toEqual(["2026-11-24T06:05:00.000Z", "2026-11-24T06:45:00.000Z"]);
  });

  it("reads time pickers as typed, not when the field was tapped (review H2)", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T07:50:00Z",
      startedAt: "2026-11-24T07:40:00Z",
      answers: [
        t("Arrival Time", "06:20", { type: "TimePicker", at: "2026-11-24T07:45:10.000Z" }),
        t("Departure Time", "06:40", { type: "TimePicker", at: "2026-11-24T07:45:30.000Z" }),
      ],
    });
    expect(span(f)).toEqual(["2026-11-24T06:20:00.000Z", "2026-11-24T06:40:00.000Z"]);
    expect(shiftLinkAction(reportSpan(f), night, [night, day], null)).toEqual({ kind: "fit" });
  });

  it("puts typed times on the date typed in the form — one labelled as a date first", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T08:00:00Z",
      answers: [
        t("Next service due", "2026-12-01"),
        t("Patrol date", "2026-11-23"),
        t("Arrival time", "23:50", { type: "TimePicker" }),
        // Before the arrival, as a time only: the next day.
        t("Departure time", "00:10", { type: "TimePicker" }),
      ],
    });
    expect(span(f)).toEqual(["2026-11-23T23:50:00.000Z", "2026-11-24T00:10:00.000Z"]);
    // Someone else's or an event's date isn't the form's date.
    const g = extractFacts({
      submittedAt: "2026-11-24T07:50:00Z",
      answers: [t("Incident date", "2026-11-20"), t("Arrival time", "07:30", { type: "TimePicker" })],
    });
    expect(iso(g.arrivedAt)).toBe("2026-11-24T07:30:00.000Z");
  });

  it("without a typed date, uses the day it was sent — over midnight too", () => {
    const f = extractFacts({
      submittedAt: "2026-11-25T00:15:00Z",
      answers: [
        t("Arrival time", "23:50", { type: "TimePicker" }),
        t("Departure time", "00:10", { type: "TimePicker" }),
      ],
    });
    expect(span(f)).toEqual(["2026-11-24T23:50:00.000Z", "2026-11-25T00:10:00.000Z"]);
  });

  it("drops a time-only departure that the next day would put after the report was sent", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T07:00:00Z",
      answers: [
        t("Arrival time", "06:00", { type: "TimePicker" }),
        t("Departure time", "05:00", { type: "TimePicker" }),
      ],
    });
    expect(iso(f.arrivedAt)).toBe("2026-11-24T06:00:00.000Z");
    expect(f.departedAt).toBeNull();
    expect(f.timesNote).toBeNull();
  });

  it("never takes someone else's time or an event's as the visit's (review M1)", () => {
    const sent = "2026-11-24T08:00:00Z";
    const alarmOff = extractFacts({
      submittedAt: sent,
      answers: [
        t("Time on site", "2026-11-24T06:10:00Z"),
        t("Time alarm turned off", "2026-11-24T06:22:00Z"),
        t("Time Left Site", "2026-11-24T07:40:00Z"),
      ],
    });
    expect(span(alarmOff)).toEqual(["2026-11-24T06:10:00.000Z", "2026-11-24T07:40:00.000Z"]);
    // …so a round that ran 40 min past a 07:00 end isn't put on the shift.
    expect(pickShift(reportSpan(alarmOff), [night], null).pick).toBeNull();
    const incident = extractFacts({
      submittedAt: sent,
      answers: [t("Incident start time", "2026-11-23T23:00:00Z"), t("Time on site", "2026-11-24T06:20:00Z")],
    });
    expect(iso(incident.when)).toBe("2026-11-24T06:20:00.000Z");
    const police = extractFacts({
      submittedAt: sent,
      answers: [t("Time Police Attended", "2026-11-24T06:05:00Z"), t("Arrival time", "2026-11-24T06:20:00Z")],
    });
    expect(iso(police.arrivedAt)).toBe("2026-11-24T06:20:00.000Z");
    // Only someone else's and the events' times: nothing typed counts.
    const none = extractFacts({
      submittedAt: sent,
      answers: [t("Keyholder arrived", "2026-11-24T06:05:00Z"), t("Time of call", "2026-11-24T05:50:00Z")],
    });
    expect(none.arrivedAt).toBeNull();
    expect(iso(none.when)).toBe("2026-11-24T08:00:00.000Z");
  });

  it("keeps the officer's own times at an alarm or callout (M1)", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T03:00:00Z",
      answers: [
        t("Alarm activation time", "2026-11-24T01:50:00Z"),
        t("Callout arrival time", "2026-11-24T02:10:00Z"),
        t("Time left alarm site", "2026-11-24T02:40:00Z"),
      ],
    });
    expect(span(f)).toEqual(["2026-11-24T02:10:00.000Z", "2026-11-24T02:40:00.000Z"]);
  });

  it("counts the officer's times at a client's place, never the client's or customer's own", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T08:00:00Z",
      answers: [
        t("Customer arrived", "2026-11-24T06:05:00Z"),
        t("Arrival at customer site", "2026-11-24T06:20:00Z"),
        t("Client contacted at", "2026-11-24T06:30:00Z"),
        t("Left customer premises", "2026-11-24T06:50:00Z"),
        t("Time customer called", "2026-11-24T07:10:00Z"),
      ],
    });
    expect(span(f)).toEqual(["2026-11-24T06:20:00.000Z", "2026-11-24T06:50:00.000Z"]);
  });

  it("counts the officer's times at a fire alarm, an incident or a callout, never the fire brigade's or the event's", () => {
    const sent = "2026-11-24T03:30:00Z";
    const fire = extractFacts({
      submittedAt: sent,
      answers: [
        t("Arrived at fire alarm", "2026-11-24T02:10:00Z"),
        t("Fire brigade attended", "2026-11-24T02:20:00Z"),
        t("Emergency services arrived", "2026-11-24T02:25:00Z"),
        t("Alarm end time", "2026-11-24T03:00:00Z"),
        t("Time left site", "2026-11-24T02:50:00Z"),
      ],
    });
    expect(span(fire)).toEqual(["2026-11-24T02:10:00.000Z", "2026-11-24T02:50:00.000Z"]);
    const incident = extractFacts({
      submittedAt: sent,
      answers: [t("Incident start time", "2026-11-24T01:30:00Z"), t("Time attended incident", "2026-11-24T02:05:00Z")],
    });
    expect(span(incident)).toEqual(["2026-11-24T02:05:00.000Z", "2026-11-24T02:05:00.000Z"]);
    const callout = extractFacts({
      submittedAt: sent,
      answers: [
        t("Time of callout", "2026-11-24T01:40:00Z"),
        t("Callout start time", "2026-11-24T02:00:00Z"),
        t("Callout finish time", "2026-11-24T02:45:00Z"),
      ],
    });
    expect(span(callout)).toEqual(["2026-11-24T02:00:00.000Z", "2026-11-24T02:45:00.000Z"]);
  });

  it("reads signed on / booked off and the like (review M2)", () => {
    const f = extractFacts({
      submittedAt: "2026-11-24T19:30:00Z",
      answers: [t("Signed On", "2026-11-24T18:20:00Z"), t("Signed Off", "2026-11-24T19:05:00Z")],
    });
    expect(span(f)).toEqual(["2026-11-24T18:20:00.000Z", "2026-11-24T19:05:00.000Z"]);
    // It started 40 min before a 19:00 shift, so it doesn't fit it.
    const shift = { id: "n", start: new Date("2026-11-24T19:00:00Z"), end: new Date("2026-11-25T07:00:00Z"), officerId: null };
    expect(pickShift(reportSpan(f), [shift], null).pick).toBeNull();
  });

  it("takes typed times up to 72 hours before it was sent, and no more than 15 minutes after (review M7)", () => {
    const sent = "2026-11-24T07:50:00Z";
    const arrival = (value: string) =>
      iso(extractFacts({ submittedAt: sent, answers: [t("Arrival time", value)] }).arrivedAt);
    expect(arrival("2026-11-21T08:50:00Z")).toBe("2026-11-21T08:50:00.000Z"); // 71 h before: sent late
    expect(arrival("2026-11-21T06:50:00Z")).toBeNull(); // 73 h before
    expect(arrival("2026-11-24T08:05:00Z")).toBe("2026-11-24T08:05:00.000Z"); // 15 min after
    expect(arrival("2026-11-24T08:10:00Z")).toBeNull(); // 20 min after: the wrong day
  });

  it("uses the send time, and says why, when the typed times are more than a day apart", () => {
    const f = extractFacts({
      submittedAt: "2026-11-25T00:15:00Z",
      answers: [t("Arrival time", "2026-11-23T23:50:00Z"), t("Departure time", "2026-11-25T00:10:00Z")],
    });
    expect(f.arrivedAt).toBeNull();
    expect(f.departedAt).toBeNull();
    expect(iso(f.when)).toBe("2026-11-25T00:15:00.000Z");
    expect(span(f)).toEqual(["2026-11-25T00:15:00.000Z", "2026-11-25T00:15:00.000Z"]);
    expect(f.timesNote).toBe("Its typed times are more than a day apart, so the send time was used.");
    // Exactly a day is still a span.
    const g = extractFacts({
      submittedAt: "2026-11-25T00:15:00Z",
      answers: [t("Arrival time", "2026-11-24T00:10:00Z"), t("Departure time", "2026-11-25T00:10:00Z")],
    });
    expect(g.timesNote).toBeNull();
    expect(span(g)).toEqual(["2026-11-24T00:10:00.000Z", "2026-11-25T00:10:00.000Z"]);
    // The robot's note says so (decide adds it to every note).
    expect(withTimesNote("Site “Mill Yard” not recognised.", f)).toBe(
      "Site “Mill Yard” not recognised. Its typed times are more than a day apart, so the send time was used.",
    );
    expect(withTimesNote(" Site found by GPS (40 m away).", g)).toBe(" Site found by GPS (40 m away).");
  });

  it("decides by the typed times everywhere: `when` is where the report's span starts (review M6)", () => {
    const sent = "2026-11-24T07:45:00Z";
    const opened = "2026-11-24T06:40:00Z";
    const cases: FastFieldAnswer[][] = [
      [],
      [t("Time left site", "2026-11-24T06:55:00Z")],
      [t("Arrival time", "2026-11-24T06:42:00Z"), t("Time left site", "2026-11-24T06:55:00Z")],
      [t("Date/Time", "2026-11-24T06:50:00Z")],
    ];
    const whens = cases.map((answers) => {
      const f = extractFacts({ submittedAt: sent, startedAt: opened, finishedAt: sent, answers });
      expect(f.when.getTime()).toBe(reportSpan(f).from.getTime());
      return iso(f.when);
    });
    // Nothing typed: when it was sent — not when the form was opened (06:40).
    expect(whens).toEqual([
      "2026-11-24T07:45:00.000Z",
      "2026-11-24T06:55:00.000Z",
      "2026-11-24T06:42:00.000Z",
      "2026-11-24T06:50:00.000Z",
    ]);
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

  it("ignores a typed time far from the submission — and never falls back to when the form was opened", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      startedAt: "2026-10-17T22:10:00.000+01:00",
      answers: shurgardAnswers({ arrive: "2025-01-01T09:00:00.000+00:00" }),
    });
    expect(f.arrivedAt).toBeNull();
    // The typed departure (22:50) decides, not the phone's opened time (22:10).
    expect(f.when.toISOString()).toBe("2026-10-17T21:50:00.000Z");
    expect(f.openedAt?.toISOString()).toBe("2026-10-17T21:10:00.000Z");
  });

  it("uses the send time, and says why, when a dated departure is before the arrival", () => {
    const f = extractFacts({
      submittedAt: SUBMITTED,
      answers: shurgardAnswers({ leave: "2026-10-17T21:00:00.000+01:00" }),
    });
    expect(f.arrivedAt).toBeNull();
    expect(f.departedAt).toBeNull();
    expect(f.when.toISOString()).toBe("2026-10-17T21:55:00.000Z");
    expect(f.timesNote).toBe("Its typed departure is before its arrival, so the send time was used.");
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

  it("doesn't take a site on 'site' and a number when the place is misspelt", () => {
    const withAdhoc = [...sites, site("adhoc", "Adhoc - SUP00202", 51.44, 0.21, "Site 1, Dartford")];
    const p = pickSite(at("Dratford site 1"), withAdhoc);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/not recognised/);
  });

  it("doesn't take a site because both places end in 'End'", () => {
    const withEnd = [...sites, site("fern", "Shurgard Fern End", 50.9, -1.3, "Fern End")];
    const p = pickSite(at("Ashby End"), withEnd);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/not recognised/);
    // With the phone at the right site, GPS finds it instead.
    const g = pickSite(at("Ashby End", 51.5533, -0.2504), withEnd);
    expect(g.site?.id).toBe("neasden");
    expect(g.site && g.how).toBe("gps");
  });
});

describe("pickSite with the client named in the site", () => {
  const SG = "c-shurgard";
  const AC = "c-access";
  const customers = [
    { id: SG, name: "Shurgard" },
    { id: AC, name: "Access" },
  ];
  const own = (row: SiteRow, customerId: string): SiteRow => ({ ...row, customerId });
  const sites = [
    own(site("woolwich", "Woolwich (SH-74)", null, null, "Thamesmead London", "SE28 0FA"), SG),
    own(site("wokingham", "Wokingham (SH-89)", null, null, "Wokingham", "RG41 2RT"), SG),
    own(site("greenwich", "Greenwich (SH-12)", null, null, "Woolwich Road Greenwich"), SG),
    own(site("acw", "Access Self Storage Woolwich (AS-12)", null, null, "Woolwich London"), AC),
    own(site("acb", "Access Self Storage Brentford (AS-47)", null, null, "Brentford"), AC),
    own(site("acs", "Access Self Storage Sutton (AS-20)", null, null, "Sutton"), AC),
  ];

  it("finds Shurgard's Woolwich from \"Shurgard self storage woolwich\"", () => {
    const p = pickSite(at("Shurgard self storage woolwich"), sites, customers);
    expect(p.site?.id).toBe("woolwich");
  });

  it("finds Access's Woolwich when the text names Access", () => {
    expect(pickSite(at("Access Self Storage Woolwich"), sites, customers).site?.id).toBe("acw");
  });

  it("prefers the site with the word in its name over one with it in the address", () => {
    expect(pickSite(at("Shurgard Woolwich"), sites, customers).site?.id).toBe("woolwich");
  });

  it("doesn't let \"self storage\" pull in every storage site", () => {
    const p = pickSite(at("self storage woolwich"), sites, customers);
    expect(p.site).toBeNull();
    expect(!p.site && p.candidates.map((c) => c.id).sort()).toEqual(["acw", "greenwich", "woolwich"]);
  });

  it("narrows only when exactly one client is named", () => {
    const one = narrowSiteText("Shurgard self storage Woolwich", sites, customers);
    expect(one.text).toBe("woolwich");
    expect(one.pool.every((x) => x.customerId === SG)).toBe(true);
    const both = narrowSiteText("Shurgard rear access gate Woolwich", sites, customers);
    expect(both.pool).toHaveLength(sites.length);
    expect(narrowSiteText("Shurgard self storage", sites, customers).text).toBeNull();
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
  const at = (iso: string) => {
    const d = new Date(iso);
    return { from: d, to: d };
  };
  const when = at("2026-10-17T21:15:00.000Z");
  const shift = (id: string, start: string, end: string, officerId: string | null = null): ShiftCandidate => ({
    id,
    start: new Date(`2026-10-17T${start}:00.000Z`),
    end: new Date(`2026-10-${end > start ? "17" : "18"}T${end}:00.000Z`),
    officerId,
  });

  it("finds the shift the report fits inside", () => {
    const p = pickShift(when, [shift("day", "07:00", "19:00"), shift("night", "19:00", "07:00")], null);
    expect(p.pick?.id).toBe("night");
  });

  it("takes a report up to 30 minutes either side of the shift, and no further", () => {
    const night = [shift("night", "19:00", "07:00")];
    const day = [shift("day", "07:00", "19:00")];
    expect(pickShift(at("2026-10-17T18:40:00.000Z"), night, null).pick?.id).toBe("night"); // 20 min early
    expect(pickShift(at("2026-10-17T18:30:00.000Z"), night, null).pick?.id).toBe("night"); // exactly 30
    expect(pickShift(at("2026-10-17T18:25:00.000Z"), night, null).pick).toBeNull(); // 35 min early
    expect(pickShift(at("2026-10-17T19:20:00.000Z"), day, null).pick?.id).toBe("day"); // 20 min late
    expect(pickShift(at("2026-10-17T19:35:00.000Z"), day, null).pick).toBeNull(); // 35 min late
  });

  it("counts the whole report: one that runs more than 30 minutes past the end doesn't fit", () => {
    const day = [shift("day", "07:00", "19:00")];
    expect(pickShift({ from: new Date("2026-10-17T18:50:00.000Z"), to: new Date("2026-10-17T19:40:00.000Z") }, day, null).pick).toBeNull();
    expect(pickShift({ from: new Date("2026-10-17T18:50:00.000Z"), to: new Date("2026-10-17T19:25:00.000Z") }, day, null).pick?.id).toBe("day");
  });

  it("prefers the shift the report is strictly inside over one it fits with the allowance", () => {
    // 07:10 fits the night shift (10 min after it ends) and is inside the day shift.
    const p = pickShift(
      { from: new Date("2026-10-18T07:10:00.000Z"), to: new Date("2026-10-18T07:10:00.000Z") },
      [shift("night", "19:00", "07:00"), { id: "day", start: new Date("2026-10-18T07:00:00.000Z"), end: new Date("2026-10-18T19:00:00.000Z"), officerId: null }],
      null,
    );
    expect(p.pick?.id).toBe("day");
  });

  it("picks the officer's own shift when it fits two", () => {
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

describe("shiftLinkAction", () => {
  const sh = (id: string, start: string, end: string, officerId: string | null = null): ShiftCandidate => ({
    id,
    start: new Date(start),
    end: new Date(end),
    officerId,
  });
  const night = sh("night", "2026-11-23T19:00:00Z", "2026-11-24T07:00:00Z");
  const day = sh("day", "2026-11-24T07:00:00Z", "2026-11-24T19:00:00Z");
  const at = (from: string, to = from) => ({ from: new Date(from), to: new Date(to) });

  it("leaves a report that fits its shift", () => {
    expect(shiftLinkAction(at("2026-11-23T23:10:00Z"), night, [night, day], null)).toEqual({ kind: "fit" });
  });

  it("leaves a report within the 30-minute allowance", () => {
    expect(shiftLinkAction(at("2026-11-24T06:55:00Z", "2026-11-24T07:10:00Z"), night, [night, day], null)).toEqual({ kind: "fit" });
  });

  it("moves a report to the shift at the site it does fit", () => {
    const a = shiftLinkAction(at("2026-11-24T07:40:00Z", "2026-11-24T07:50:00Z"), night, [night, day], null);
    expect(a.kind).toBe("move");
    if (a.kind === "move") {
      expect(a.to.id).toBe("day");
      expect(a.why).toEqual({ fits: false, side: "after", minutes: 50 });
    }
  });

  it("takes it off when it fits no shift there", () => {
    const a = shiftLinkAction(at("2026-11-24T11:00:00Z", "2026-11-24T11:10:00Z"), night, [night], null);
    expect(a).toEqual({ kind: "off", why: { fits: false, side: "after", minutes: 250 } });
  });

  it("never moves it back onto the shift it's on", () => {
    expect(shiftLinkAction(at("2026-11-23T18:00:00Z"), night, [night], null).kind).toBe("off");
  });

  it("prefers the officer's own shift when it fits two", () => {
    const a1 = sh("a1", "2026-11-24T07:00:00Z", "2026-11-24T19:00:00Z", "u1");
    const a2 = sh("a2", "2026-11-24T07:00:00Z", "2026-11-24T19:00:00Z", "u2");
    const a = shiftLinkAction(at("2026-11-24T08:00:00Z"), night, [night, a1, a2], "u2");
    expect(a.kind === "move" && a.to.id).toBe("a2");
  });
});

describe("reportSpan", () => {
  const d = (iso: string) => new Date(iso);
  const none = { arrivedAt: null, departedAt: null, submittedAt: d("2026-11-18T07:50:00Z") };

  it("uses the arrival and departure typed in the form", () => {
    const span = reportSpan({
      ...none,
      arrivedAt: d("2026-11-17T23:10:00Z"),
      departedAt: d("2026-11-17T23:25:00Z"),
    });
    expect(span.from.toISOString()).toBe("2026-11-17T23:10:00.000Z");
    expect(span.to.toISOString()).toBe("2026-11-17T23:25:00.000Z");
  });

  it("is one moment when the form gives only one typed time", () => {
    const arrival = reportSpan({ ...none, arrivedAt: d("2026-11-17T23:10:00Z") });
    expect(arrival.from.toISOString()).toBe("2026-11-17T23:10:00.000Z");
    expect(arrival.to.getTime()).toBe(arrival.from.getTime());
    const departure = reportSpan({ ...none, departedAt: d("2026-11-17T23:40:00Z") });
    expect(departure.from.toISOString()).toBe("2026-11-17T23:40:00.000Z");
  });

  it("never uses when the form was opened or finished on the phone", () => {
    const facts = extractFacts({
      submittedAt: "2026-11-18T07:50:00Z",
      startedAt: "2026-11-18T06:50:00Z",
      finishedAt: "2026-11-18T07:45:00Z",
      answers: [
        { key: "a", label: "Arrive Date/Time", type: "DatePicker", value: "2026-11-18T06:20:00.000Z" },
        { key: "b", label: "Signed Off Date/Time", type: "DatePicker", value: "2026-11-18T06:35:00.000Z" },
      ],
    });
    const span = reportSpan(facts);
    expect(span.from.toISOString()).toBe("2026-11-18T06:20:00.000Z");
    expect(span.to.toISOString()).toBe("2026-11-18T06:35:00.000Z");
  });

  it("with no time typed at all, uses when it was sent", () => {
    const facts = extractFacts({
      submittedAt: "2026-11-18T07:50:00Z",
      startedAt: "2026-11-18T06:50:00Z",
      finishedAt: "2026-11-18T07:45:00Z",
      answers: [],
    });
    const span = reportSpan(facts);
    expect(span.from.toISOString()).toBe("2026-11-18T07:50:00.000Z");
    expect(span.to.toISOString()).toBe("2026-11-18T07:50:00.000Z");
  });

  it("never ends before it starts", () => {
    const span = reportSpan({ ...none, arrivedAt: d("2026-11-17T23:10:00Z"), departedAt: d("2026-11-17T23:00:00Z") });
    expect(span.to.getTime()).toBe(span.from.getTime());
  });
});

describe("shiftFit", () => {
  const shift = { start: new Date("2026-11-17T19:00:00Z"), end: new Date("2026-11-18T07:00:00Z") };
  const span = (from: string, to = from) => ({ from: new Date(from), to: new Date(to) });

  it("fits from the start to the end exactly", () => {
    expect(shiftFit(span("2026-11-17T19:00:00Z", "2026-11-18T07:00:00Z"), shift).fits).toBe(true);
    expect(shiftFit(span("2026-11-17T23:00:00Z", "2026-11-17T23:12:00Z"), shift).fits).toBe(true);
  });

  it("allows 30 minutes either side, and no more", () => {
    expect(shiftFit(span("2026-11-17T18:30:00Z", "2026-11-17T18:45:00Z"), shift).fits).toBe(true);
    expect(shiftFit(span("2026-11-18T07:00:00Z", "2026-11-18T07:30:00Z"), shift).fits).toBe(true);
    expect(shiftFit(span("2026-11-17T18:29:00Z"), shift)).toEqual({ fits: false, side: "before", minutes: 31 });
    expect(shiftFit(span("2026-11-18T07:31:00Z"), shift)).toEqual({ fits: false, side: "after", minutes: 31 });
  });

  it("says when a report starts before the shift", () => {
    const fit = shiftFit(span("2026-11-17T18:20:00Z", "2026-11-17T18:35:00Z"), shift);
    expect(fit).toEqual({ fits: false, side: "before", minutes: 40 });
    if (!fit.fits) expect(outsideShiftText(fit)).toBe("started 40 min before the shift");
  });

  it("says when a report finishes after the shift ends", () => {
    const fit = shiftFit(span("2026-11-18T06:55:00Z", "2026-11-18T08:10:00Z"), shift);
    expect(fit).toEqual({ fits: false, side: "after", minutes: 70 });
    if (!fit.fits) expect(outsideShiftText(fit)).toBe("finished 1 h 10 min after the shift ended");
  });

  it("strictly (no allowance), counts a few seconds over as a minute, never zero", () => {
    const fit = shiftFit(span("2026-11-18T07:00:20Z"), shift, 0);
    expect(fit).toEqual({ fits: false, side: "after", minutes: 1 });
  });
});

describe("spanText / shiftHoursText", () => {
  it("shows the date once, and both times", () => {
    const t = spanText({ from: new Date("2026-11-17T23:10:00Z"), to: new Date("2026-11-17T23:25:00Z") });
    expect(t).toMatch(/^17 Nov.*23:10–23:25$/);
  });
  it("shows both dates across midnight, and one time for one moment", () => {
    expect(spanText({ from: new Date("2026-11-17T23:50:00Z"), to: new Date("2026-11-18T00:10:00Z") })).toMatch(
      /17 Nov.*23:50–18 Nov.*00:10/,
    );
    const one = new Date("2026-11-17T23:10:00Z");
    expect(spanText({ from: one, to: one })).not.toContain("–");
  });
  it("shows a shift's hours", () => {
    expect(
      shiftHoursText({ start: new Date("2026-11-17T19:00:00Z"), end: new Date("2026-11-18T07:00:00Z") }),
    ).toMatch(/^17 Nov.*19:00–07:00$/);
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

describe("siteKey", () => {
  it("makes spellings that differ only in case, spaces or punctuation the same place", () => {
    expect(siteKey("AB1 2CD")).toBe("ab12cd");
    expect(siteKey("ab12cd")).toBe("ab12cd");
    expect(siteKey("  Fern  Court! ")).toBe("ferncourt");
    expect(siteKey("Fern-Court")).toBe("ferncourt");
  });

  it("is null when nothing is typed", () => {
    expect(siteKey(null)).toBeNull();
    expect(siteKey("")).toBeNull();
    expect(siteKey(" – ")).toBeNull();
  });
});

describe("groupByPlace", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 10, day, 21));
  const rows = [
    { siteText: "Fern Court", submittedAt: at(1), siteName: null },
    { siteText: "fern court", submittedAt: at(2), siteName: null },
    { siteText: "Fern  Court", submittedAt: at(3), siteName: null },
    { siteText: "AB12CD", submittedAt: at(4), siteName: null },
    { siteText: "AB1 2CD", submittedAt: at(5), siteName: null },
    { siteText: "AB12CD", submittedAt: at(6), siteName: null },
    { siteText: "Mill Yard", submittedAt: at(7), siteName: "Mill Yard Depot" },
    { siteText: null, submittedAt: at(8), siteName: null },
    { siteText: "  ", submittedAt: at(9), siteName: null },
  ];

  it("groups by place, biggest first, then the most recent; leaves out reports with no site typed", () => {
    const g = groupByPlace(rows);
    expect(g.map((x) => [x.key, x.count])).toEqual([
      ["ab12cd", 3], // the same size as "ferncourt", but more recent
      ["ferncourt", 3],
      ["millyard", 1],
    ]);
    expect(g[0].latest).toEqual(at(6));
  });

  it("labels a group with the spelling typed most often, the latest on a tie", () => {
    const g = groupByPlace(rows);
    expect(g.find((x) => x.key === "ab12cd")?.label).toBe("AB12CD");
    // "Fern Court" and "Fern  Court" are one spelling once spaces are tidied.
    expect(g.find((x) => x.key === "ferncourt")?.label).toBe("Fern Court");
  });

  it("says which site the robot matched them to", () => {
    const g = groupByPlace(rows);
    expect(g.find((x) => x.key === "millyard")?.siteName).toBe("Mill Yard Depot");
    expect(g.find((x) => x.key === "ab12cd")?.siteName).toBeNull();
  });
});

describe("shiftApartMin", () => {
  const shift = { id: "s1", officerId: null, start: new Date("2026-11-17T19:00:00Z"), end: new Date("2026-11-18T07:00:00Z") };
  const at = (iso: string) => ({ from: new Date(iso), to: new Date(iso) });

  it("is 0 only when the report fits inside the shift", () => {
    expect(shiftApartMin(at("2026-11-17T23:00:00Z"), shift)).toBe(0);
    expect(shiftApartMin(at("2026-11-17T18:40:00Z"), shift)).toBe(20); // 20 min early
    expect(shiftApartMin(at("2026-11-18T07:50:00Z"), shift)).toBe(50); // 50 min late
  });

  it("counts how far it runs past the start or the end", () => {
    expect(shiftApartMin(at("2026-11-17T09:00:00Z"), shift)).toBe(600); // 10 h before it starts
    expect(shiftApartMin(at("2026-11-18T19:30:00Z"), shift)).toBe(750); // 12 h 30 min after it ends
  });
});
