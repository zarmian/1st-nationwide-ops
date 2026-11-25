import { describe, it, expect } from "vitest";
import {
  answerKind,
  apartText,
  extractFacts,
  extractPostcode,
  groupByPlace,
  matchOfficer,
  matchOfficerName,
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

  it("takes only Yes / No / N/A fields as three-state, not any type with \"tri\" in it", () => {
    expect(answerKind("TriState")).toBe("tri");
    expect(answerKind("StringEntry")).toBe("text");
    expect(answerKind("Matrix")).toBe("other");
  });

  it("reads radio buttons, check boxes and drop-downs as text (the option picked)", () => {
    for (const t of ["RadioButtons", "RadioButtonList", "CheckBox", "CheckboxList", "DropDown", "MultiSelect"]) {
      expect(answerKind(t)).toBe("text");
    }
    expect(answerKind("Switch")).toBe("other");
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

  it("doesn't take a site on 'site' and a number when the place is misspelt", () => {
    const withAdhoc = [...sites, site("adhoc", "Adhoc - SUP00202", 51.44, 0.21, "Site 1, Dartford")];
    const p = pickSite(at("Dratford site 1"), withAdhoc);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/not recognised/);
  });

  it("settles a name that fits several sites by GPS among those with it in their name only", () => {
    const woolwich = [
      site("w1", "Woolwich North", 51.49, 0.07),
      site("w2", "Woolwich South", 51.48, 0.07),
      site("gr", "Greenwich", 51.4801, 0.0101, "Woolwich Road"),
    ];
    // The phone at Greenwich, which is only on Woolwich Road: not picked.
    const p = pickSite(at("Woolwich", 51.4801, 0.0101), woolwich);
    expect(p.site).toBeNull();
    expect(!p.site && p.candidates.map((c) => c.id).sort()).toEqual(["w1", "w2"]);
    // The phone at Woolwich South: that one.
    const q = pickSite(at("Woolwich", 51.4802, 0.0702), woolwich);
    expect(q.site?.id).toBe("w2");
    expect(q.site && q.how).toBe("name+gps");
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
    // The two with Woolwich in their name; not Greenwich, on Woolwich Road.
    expect(!p.site && p.candidates.map((c) => c.id).sort()).toEqual(["acw", "woolwich"]);
    expect(!p.site && p.reason).toMatch(/fits 2 sites/);
  });

  it("keeps the GPS fallback to the named client's sites (a wait, never another client's site)", () => {
    const withGps = [
      own(site("riverside", "Riverside (SH-1)", 51.5, 0.0, "Riverside Road"), SG),
      own(site("hilltop", "Access Self Storage Hilltop (AS-2)", 51.6, 0.1, "Hilltop"), AC),
    ];
    // The text names Access, but no Access site called Lowfield: the phone
    // next to the Shurgard site doesn't pick it.
    const p = pickSite(at("Access Self Storage Lowfield", 51.50005, 0.00005), withGps, customers);
    expect(p.site).toBeNull();
    expect(!p.site && p.reason).toMatch(/not recognised/);
    // Without a client named, GPS alone finds it.
    expect(pickSite(at("Lowfield", 51.50005, 0.00005), withGps, customers).site?.id).toBe("riverside");
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

  const withAnswer = (label: string, value: string, name = "Shurgard Neasden") =>
    extractFacts({
      submittedAt: SUBMITTED,
      answers: [
        { key: "a", label: "Site Name", type: "SingleLineEntry", value: name },
        { key: "b", label, type: "SingleLineEntry", value },
      ],
    });

  it.each([
    ["Site Postcode", "w3 6uu"],
    ["Post Code", "W3 6UU"],
    ["Site address", "12 High St, Acton W3 6UU"],
    ["Address of premises", "12 High St, Acton W3 6UU"],
    ["Client site postcode", "W3 6UU"],
  ])("reads the site's postcode from “%s”", (label, value) => {
    expect(withAnswer(label, value, "Shurgard").postcode).toBe("W36UU");
  });

  it.each([
    ["Customer address (if stuck on site)", "12 High St, Acton W3 6UU"],
    ["Customer postcode", "W3 6UU"],
    ["Patrol location notes", "Checked the bins behind W3 6UU"],
    ["Site notes", "Spare keys with the shop at W3 6UU"],
    ["Site attended", "W3 6UU"],
    ["Location", "W3 6UU"],
  ])("doesn't take a postcode from “%s”, so the typed site name stands", (label, value) => {
    const f = withAnswer(label, value);
    expect(f.postcode).toBeNull();
    expect(pickSite(f, sites).site?.id).toBe("neasden");
  });

  describe("when the site name and the postcode point to different sites", () => {
    // "Neasden" names Shurgard Neasden; W3 6UU is Shurgard Acton's.
    const facts = (lat: number | null = null, lng: number | null = null) => ({
      siteText: "Neasden",
      postcode: "W36UU",
      lat,
      lng,
    });

    it("picks neither, and leaves nothing for the work on at the time to settle", () => {
      const p = pickSite(facts(), sites);
      expect(p.site).toBeNull();
      expect(!p.site && p.reason).toMatch(/^The site name and the postcode point to different sites/);
      expect(!p.site && p.candidates).toEqual([]);
      // From the form itself, too.
      expect(pickSite(withAnswer("Site Postcode", "W3 6UU"), sites).site).toBeNull();
    });

    it("lets a GPS fix that clearly favours one settle it", () => {
      const atActon = pickSite(facts(51.5151, -0.2702), sites);
      expect(atActon.site?.id).toBe("acton");
      expect(atActon.site && atActon.how).toBe("postcode+gps");
      const atNeasden = pickSite(facts(51.5532, -0.2502), sites);
      expect(atNeasden.site?.id).toBe("neasden");
      expect(atNeasden.site && atNeasden.how).toBe("name+gps");
    });

    it("doesn't let a fix that's about as near to both settle it", () => {
      // 1.8 km from Acton, 2.8 km from Neasden.
      expect(pickSite(facts(51.531, -0.27), sites).site).toBeNull();
      // Over 2 km from both.
      expect(pickSite(facts(51.534, -0.26), sites).site).toBeNull();
    });

    it("isn't a disagreement when they agree, or the name only fits an address or several sites", () => {
      expect(pickSite({ ...facts(), siteText: "Acton" }, sites)).toMatchObject({ site: { id: "acton" }, how: "postcode" });
      // "Lane" is only in Neasden's address (Neasden Lane): the postcode stands.
      expect(pickSite(at("Lane W3 6UU"), sites).site?.id).toBe("acton");
      // "Shurgard" fits two sites: the postcode stands.
      expect(pickSite(at("Shurgard W3 6UU"), sites).site?.id).toBe("acton");
    });
  });

  it("doesn't read a floor number as a postcode", () => {
    expect(extractPostcode("Unit B2 3rd floor")).toBeNull();
    expect(extractPostcode("Block B2 3rd Floor, Neasden NW10 7UD")).toBe("NW107UD");
    // A real postcode that ends like an ordinal still counts.
    expect(extractPostcode("Riverside SE1 9TH")).toBe("SE19TH");
    const f = extractFacts({
      submittedAt: SUBMITTED,
      answers: [{ key: "a", label: "Site Name", type: "SingleLineEntry", value: "Neasden, Unit B2 3rd floor" }],
    });
    expect(f.postcode).toBeNull();
    expect(pickSite(f, sites).site?.id).toBe("neasden");
  });
});

describe("extractFacts: which answer is the site, and which the officer", () => {
  const facts = (...answers: [label: string, value: unknown, type?: string][]) =>
    extractFacts({
      submittedAt: SUBMITTED,
      answers: answers.map(([label, value, type], i) => ({
        key: `k${i}`,
        label,
        type: type ?? "SingleLineEntry",
        value,
      })),
    });

  it.each([
    ["Site Attended"],
    ["Patrol Location"],
    ["Location attended"],
    ["Customer site"],
    ["Client's premises"],
    ["Name of site attended"],
  ])("takes “%s” as the site, not the officer", (label) => {
    const f = facts([label, "Riverside Storage"], ["Officer Name", "Ana Test"]);
    expect(f.siteText).toBe("Riverside Storage");
    expect(f.officerText).toBe("Ana Test");
  });

  it.each([
    ["Staff on site?", "2"],
    ["Vehicles on site", "One van"],
    ["Site notes", "Rear gate sticks"],
    ["Patrol location notes", "Checked the yard"],
    ["Building secure?", "Secure"],
    ["Damage to property", "Broken fence panel"],
    ["Alarm location", "Zone 3 rear door"],
    ["Customer address (if stuck on site)", "12 High St"],
    ["GPS location", "51.55, -0.25"],
    ["Site attended by", "Ana Test"],
  ])("doesn't take “%s” as the site", (label, value) => {
    expect(facts([label, value], ["Site Name", "Riverside Storage"]).siteText).toBe("Riverside Storage");
  });

  it.each([
    ["Officer Name/SIA Number"],
    ["Attended by"],
    ["Patrolled by"],
    ["Staff name"],
    ["Staff"],
    ["Guard"],
    ["Your Name"],
  ])("takes “%s” as the officer", (label) => {
    expect(facts(["Site Name", "Riverside Storage"], [label, "Ana Test"]).officerText).toBe("Ana Test");
  });

  it.each([
    ["Patrol Notes", "All quiet, gates locked"],
    ["Patrol type", "Mobile"],
    ["Staff on site?", "Yes"],
    ["Officer comments", "All secure"],
    ["SIA licence checked?", "Yes"],
    ["Guard dog used?", "No"],
  ])("doesn't take “%s” as the officer, even before the officer's name", (label, value) => {
    const f = facts(["Site Name", "Riverside Storage"], [label, value], ["Officer Name", "Ana Test"]);
    expect(f.officerText).toBe("Ana Test");
  });

  it("never takes a long answer as the officer", () => {
    const note =
      "Officer arrived on time, walked the whole perimeter, found the rear shutter open and secured it before leaving.";
    expect(facts(["Patrol officer", note]).officerText).toBeNull();
  });

  it("reads a site picked from radio buttons, but never a ticked box or a yes / no", () => {
    expect(facts(["Site", "Riverside Storage", "RadioButtons"]).siteText).toBe("Riverside Storage");
    const f = facts(
      ["Site", true, "CheckBox"],
      ["Premises", 1, "CheckBox"],
      ["Location", "Yes", "RadioButtons"],
      ["Site Name", "Riverside Storage"],
    );
    expect(f.siteText).toBe("Riverside Storage");
    expect(facts(["Officer", true, "CheckBox"], ["Officer Name", "Ana Test"]).officerText).toBe("Ana Test");
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
  it("doesn't read a property's type, a reference or a finding as the kind of visit", () => {
    expect(visitTypeOf([ans("Property type", "Lock-up unit")])).toBeNull();
    expect(visitTypeOf([ans("Job number", "LOCK-221")])).toBeNull();
    expect(visitTypeOf([ans("Job type", "LOCK-221")])).toBeNull();
    expect(visitTypeOf([ans("Reason for visit", "Gate found unlocked")])).toBeNull();
  });
  it("reads whole words, also from radio buttons", () => {
    expect(visitTypeOf([ans("Visit type", "Lock-up")])).toBe("LOCK");
    expect(visitTypeOf([ans("Visit type", "Lockup 2")])).toBe("LOCK");
    expect(visitTypeOf([ans("Visit type", "Unlocking")])).toBe("UNLOCK");
    expect(visitTypeOf([ans("Job type", "Key collection")])).toBe("KEY_COLLECTION");
    expect(visitTypeOf([{ key: "r", label: "Visit type", type: "RadioButtons", value: "Lock up" }])).toBe("LOCK");
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

  // With the rota's own times, as the import passes them.
  const rota = (id: string, start: string, end: string, actual?: { start?: string; end?: string }): ShiftCandidate => {
    const s = new Date(start);
    const e = new Date(end);
    const as = actual?.start ? new Date(actual.start) : s;
    const ae = actual?.end ? new Date(actual.end) : e;
    return {
      id,
      officerId: null,
      start: as < s ? as : s,
      end: ae > e ? ae : e,
      scheduled: { start: s, end: e },
    };
  };
  const moment = (iso: string) => ({ from: new Date(iso), to: new Date(iso) });

  it("prefers the shift the rota has the report in over one stretched by a stale clock-out", () => {
    // The night shift's officer never clocked out, so its window runs to the
    // next morning and holds the day shift's noon round too.
    const night = rota("night", "2026-11-24T19:00:00Z", "2026-11-25T07:00:00Z", { end: "2026-11-26T10:00:00Z" });
    const day = rota("day", "2026-11-25T07:00:00Z", "2026-11-25T19:00:00Z");
    expect(pickShift(moment("2026-11-25T12:00:00Z"), [night, day], null).pick?.id).toBe("day");
    // A round in the night still goes on the night shift.
    expect(pickShift(moment("2026-11-25T02:00:00Z"), [night, day], null).pick?.id).toBe("night");
  });

  it("puts a round at the handover moment on the shift that's starting", () => {
    const day = rota("day", "2026-11-24T07:00:00Z", "2026-11-24T19:00:00Z");
    const night = rota("night", "2026-11-24T19:00:00Z", "2026-11-25T07:00:00Z");
    expect(pickShift(moment("2026-11-24T19:00:00Z"), [day, night], null).pick?.id).toBe("night");
    // One that ends at the handover was the day shift's.
    expect(
      pickShift({ from: new Date("2026-11-24T18:50:00Z"), to: new Date("2026-11-24T19:00:00Z") }, [day, night], null).pick?.id,
    ).toBe("day");
  });

  it("breaks a last tie by the scheduled start, not an early clock-in", () => {
    // Both on the rota at 10:00; "a" is scheduled later but was clocked in at 05:00.
    const a = rota("a", "2026-11-24T08:00:00Z", "2026-11-24T20:00:00Z", { start: "2026-11-24T05:00:00Z" });
    const b = rota("b", "2026-11-24T07:00:00Z", "2026-11-24T19:00:00Z");
    expect(pickShift(moment("2026-11-24T10:00:00Z"), [a, b], null).pick?.id).toBe("b");
  });

  it("counts both ends when a report runs past a short shift", () => {
    const span = { from: new Date("2026-10-17T18:50:00.000Z"), to: new Date("2026-10-17T19:50:00.000Z") };
    // "a": 10 min before + 20 min after = 30; "b": 15 min after.
    const a = shift("a", "19:00", "19:30");
    const b = shift("b", "18:40", "19:35");
    expect(pickShift(span, [a, b], null).pick?.id).toBe("b");
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

  it("leaves a report that fits its shift even when another shift has it strictly inside", () => {
    // 07:10–07:20 is inside the day shift, and within the allowance of the
    // night one it's on: it stays, so reports don't hop between shifts.
    expect(shiftLinkAction(at("2026-11-24T07:10:00Z", "2026-11-24T07:20:00Z"), night, [night, day], null)).toEqual({ kind: "fit" });
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

  it("rounds the minutes up when it doesn't fit, so they're always more than the allowance", () => {
    // 30 min 20 s early: doesn't fit, and says 31 — never "30 min, more than the 30 allowed".
    const early = shiftFit(span("2026-11-17T18:29:40Z"), shift);
    expect(early).toEqual({ fits: false, side: "before", minutes: 31 });
    if (!early.fits) expect(outsideShiftText(early)).toBe("started 31 min before the shift");
    expect(shiftFit(span("2026-11-18T07:30:20Z"), shift)).toEqual({ fits: false, side: "after", minutes: 31 });
    // Exactly 30 minutes either side still fits.
    expect(shiftFit(span("2026-11-17T18:30:00Z"), shift).fits).toBe(true);
    expect(shiftFit(span("2026-11-18T07:30:00Z"), shift).fits).toBe(true);
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
  it("shows a shift's hours, with the end date when it ends on another day", () => {
    const hours = (start: string, end: string) => shiftHoursText({ start: new Date(start), end: new Date(end) });
    expect(hours("2026-11-17T07:00:00Z", "2026-11-17T19:00:00Z")).toMatch(/^17 Nov.*07:00–19:00$/);
    expect(hours("2026-11-17T19:00:00Z", "2026-11-18T07:00:00Z")).toMatch(/^17 Nov.*19:00–18 Nov.*07:00$/);
    // A 24-hour shift isn't "07:00–07:00".
    expect(hours("2026-11-24T07:00:00Z", "2026-11-25T07:00:00Z")).toMatch(/^24 Nov.*07:00–25 Nov.*07:00$/);
    // UK days: 22:00–23:30 UTC on 17 July is 23:00–00:30 BST, ending on the 18th.
    expect(hours("2026-07-17T22:00:00Z", "2026-07-17T23:30:00Z")).toMatch(/^17 Jul.*23:00–18 Jul.*00:30$/);
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

  const staff = (...names: string[]) => names.map((name, i) => ({ id: `p${i}`, name, siaNumber: null }));

  it("matches whole words, never part of a longer name", () => {
    const others = staff("Natalie Brown", "Brian Cole", "Jordan Lee", "Akash Patel");
    for (const typed of ["Ali", "Ian", "Dan", "Ash"]) expect(pickOfficer(facts(typed), others)).toBeNull();
    expect(pickOfficer(facts("Ali"), [...others, { id: "ali", name: "Ali Khan", siaNumber: null }])).toBe("ali");
    expect(pickOfficer(facts("Ali"), [...others, { id: "mo", name: "Mo Ali", siaNumber: null }])).toBe("mo");
  });

  it("needs every typed word to be one of the person's names", () => {
    const two = staff("Sam Jones", "Ian Taylor");
    expect(pickOfficer(facts("Sam Taylor"), two)).toBeNull();
    expect(pickOfficer(facts("Taylor Ian"), two)).toBe("p1");
  });

  it("takes an initial when only one person fits it, but not initials alone", () => {
    const khans = staff("Ahmed Khan", "Sam Taylor");
    expect(pickOfficer(facts("A. Khan"), khans)).toBe("p0");
    expect(pickOfficer(facts("Ahmed K"), khans)).toBe("p0");
    expect(pickOfficer(facts("A Khan"), [...khans, { id: "ali", name: "Ali Khan", siaNumber: null }])).toBeNull();
    expect(pickOfficer(facts("S Khan"), khans)).toBeNull();
    expect(pickOfficer(facts("A. K."), khans)).toBeNull();
  });

  it("ignores titles, the job, accents, apostrophes and stray numbers", () => {
    const one = staff("José O’Brien", "Sam Taylor");
    expect(pickOfficer(facts("Officer Jose O'Brien"), one)).toBe("p0");
    expect(pickOfficer(facts("Mr Sam Taylor 1234"), one)).toBe("p1");
  });

  it("takes the exact full name over someone whose name has it in", () => {
    expect(pickOfficer(facts("Ahmed Khan"), staff("Ahmed Khan", "Ahmed Khan Mirza"))).toBe("p0");
    expect(pickOfficer(facts("Khan"), staff("Ahmed Khan", "Ahmed Khan Mirza"))).toBeNull();
  });

  it("says when several people fit, so the import doesn't go on to look among staff who've left", () => {
    const m = matchOfficer(facts("Ahmed"), people);
    expect(m.kind).toBe("many");
    expect(m.kind === "many" && m.people.map((p) => p.id).sort()).toEqual(["u1", "u2"]);
    expect(matchOfficer(facts("Nobody Known"), people).kind).toBe("none");
    expect(matchOfficerName("Sam", people)).toMatchObject({ kind: "one", person: { id: "u3" } });
    // An SIA number held by exactly one person settles it.
    expect(matchOfficer(facts("Ahmed 1234567890123456"), people)).toMatchObject({ kind: "one", person: { id: "u1" } });
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

  it("waits when the best match already has a report, rather than taking another activity", () => {
    // The callout at 21:00 has its report; a second report says 21:15. The
    // unlock at 22:30 is free, but mustn't be marked done and billed for it.
    const p = pickActivity(when, "ALARM_RESPONSE", [
      job("callout", "ALARM_RESPONSE", "21:00", true),
      job("unlock", "UNLOCK", "22:30"),
    ]);
    expect(p.pick).toBeNull();
    expect(p.pick === null && p.reason === "taken" && [p.taken.id, p.at.toISOString(), p.minutesApart]).toEqual([
      "callout",
      at("21:00").toISOString(),
      15,
    ]);
  });

  it("still takes a free activity that's the better match", () => {
    const p = pickActivity(when, "ALARM_RESPONSE", [
      job("old", "LOCK", "19:30", true), // 1 h 45 min away
      job("callout", "ALARM_RESPONSE", "21:25"), // 10 min away
    ]);
    expect(p.pick?.id).toBe("callout");
  });

  it("settles a close call between a taken and a free activity the same way", () => {
    // Taken callout 5 min away, free one 15 min away: about as close; the nearer wins → wait.
    const taken = pickActivity(when, "ALARM_RESPONSE", [
      job("done", "ALARM_RESPONSE", "21:10", true),
      job("free", "ALARM_RESPONSE", "21:30"),
    ]);
    expect(!taken.pick && taken.reason).toBe("taken");
    // Free callout 3 min away, taken one 10 min away: the free one wins, as a close call.
    const free = pickActivity(when, "ALARM_RESPONSE", [
      job("free", "ALARM_RESPONSE", "21:12"),
      job("done", "ALARM_RESPONSE", "21:25", true),
    ]);
    expect(free.pick?.id).toBe("free");
    expect(free.pick && free.closeCall).toBe(true);
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

  it("waits when the best similar one already has a report, rather than taking another", () => {
    const p = pickActivityWide(
      when,
      "ALARM_RESPONSE",
      [job("done", "ALARM_RESPONSE", "17T20:00", true), job("later", "ALARM_RESPONSE", "18T08:30")],
      now,
    );
    expect(p.pick === null && p.reason === "taken" && p.taken.id).toBe("done");
    // A free one that's nearer still wins.
    const q = pickActivityWide(
      when,
      "ALARM_RESPONSE",
      [job("done", "ALARM_RESPONSE", "17T17:00", true), job("free", "ALARM_RESPONSE", "17T22:00")],
      now,
    );
    expect(q.pick?.id).toBe("free");
    // A taken one of another kind, or not due yet, doesn't count.
    expect(
      pickActivityWide(when, "ALARM_RESPONSE", [job("lock", "LOCK", "17T21:00", true), job("free", "ALARM_RESPONSE", "17T17:00")], now).pick?.id,
    ).toBe("free");
    expect(pickActivityWide(when, "PATROL", [job("tonight", "PATROL", "18T19:00", true)], now)).toMatchObject({ reason: "none" });
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

  it("adds up both ends when a report runs past both", () => {
    const short = { id: "s2", officerId: null, start: new Date("2026-11-17T19:00:00Z"), end: new Date("2026-11-17T19:30:00Z") };
    // 5 min before it starts + 10 min after it ends.
    expect(
      shiftApartMin({ from: new Date("2026-11-17T18:55:00Z"), to: new Date("2026-11-17T19:40:00Z") }, short),
    ).toBe(15);
  });

  it("rounds up, so it's 0 only when the report is strictly inside", () => {
    expect(shiftApartMin(at("2026-11-18T07:00:20Z"), shift)).toBe(1);
    expect(shiftApartMin(at("2026-11-18T07:00:00Z"), shift)).toBe(0);
  });
});
