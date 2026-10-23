/**
 * FastField reports — the pure half of the import (no database, no network).
 *
 * The FastField robot (scripts/fastfield-forms.mjs) reads each submission off
 * the FastField portal and POSTs it as an ordered list of answers. These
 * helpers turn that into what the import needs to attach it to an activity —
 * which site, who attended, when they arrived and left, where the phone was —
 * and rank the activities at that site to pick the one it belongs to.
 *
 * FastField forms are built by the office, so nothing here relies on a fixed
 * layout: facts are found by the answers' labels ("Site Name", "Officer
 * Name/SIA Number", "Arrive Date/Time", …) with sensible fallbacks.
 */
import { ukWallClockToUtc } from "@/lib/dates";
import { haversineMeters } from "@/lib/geo";
import {
  isWeakWord,
  matchPerson,
  matchSite,
  type SiteCandidate,
} from "@/lib/telegramCallout";

// ── What the robot sends ──────────────────────────────────────────────────

export type FastFieldAnswer = {
  /** FastField's field key, e.g. "datepicker_1". */
  key: string;
  label: string;
  /** FastField's field type, e.g. "DatePicker", "MultiPhotoPicker". */
  type: string;
  /** The answer. Photos/signatures arrive already copied: [{url}] / {url}. */
  value: unknown;
  /** When the officer filled this field in (fields set to capture it). */
  at?: string | null;
  /** Where the phone was when they did (fields set to capture location). */
  lat?: number | null;
  lng?: number | null;
};

export type FastFieldIncoming = {
  /** FastField's submission id — the import's key. */
  submissionId: string;
  formId: number;
  formName: string;
  /** When FastField received it (ISO). */
  submittedAt: string;
  /** When the form was opened / finished on the phone (ISO). */
  startedAt?: string | null;
  finishedAt?: string | null;
  /** The FastField account that submitted it. */
  submittedBy?: string | null;
  answers: FastFieldAnswer[];
  photoUrls?: string[];
  signatureUrl?: string | null;
};

// ── Field kinds ───────────────────────────────────────────────────────────

export type AnswerKind =
  | "date"
  | "location"
  | "photo"
  | "signature"
  | "tri"
  | "text"
  | "other";

export function answerKind(type: string): AnswerKind {
  const t = type.toLowerCase();
  if (/signature/.test(t)) return "signature";
  if (/photo|image|sketch|annotat/.test(t)) return "photo";
  if (/location|geo|gps/.test(t)) return "location";
  if (/timer/.test(t)) return "other";
  if (/date|time/.test(t)) return "date";
  if (/threestate|tri/.test(t)) return "tri";
  if (/entry|text|alpha|list|lookup|picker|barcode|email|phone/.test(t)) return "text";
  return "other";
}

/** An answer as display text, or null when it's blank / not text-like. */
export function answerText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(answerText).filter((s): s is string => !!s);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["text", "label", "name", "value", "displayValue"]) {
      if (typeof o[k] === "string" && (o[k] as string).trim()) {
        return (o[k] as string).trim();
      }
    }
  }
  return null;
}

/**
 * FastField times arrive as ISO strings, normally with an offset
 * ("2026-10-17T22:15:00.000+01:00"). One without a zone is read as UK
 * wall-clock time, not the server's UTC.
 */
export function parseFastFieldTime(s: unknown): Date | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const v = s.trim();
  const local = v.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/,
  );
  if (local) {
    return ukWallClockToUtc(
      Number(local[1]),
      Number(local[2]),
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      local[6] ? Number(local[6]) : 0,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null; // date-only etc.
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** The time an answer records: the value when it holds a time, else when the
 *  officer filled it in. */
export function answerTime(a: FastFieldAnswer): Date | null {
  return parseFastFieldTime(a.value) ?? parseFastFieldTime(a.at);
}

function validCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = typeof lat === "string" ? Number(lat) : lat;
  const ln = typeof lng === "string" ? Number(lng) : lng;
  if (typeof la !== "number" || typeof ln !== "number") return null;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la === 0 && ln === 0) return null; // FastField's "not captured"
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

/** Coordinates held by a location answer's value ({ latitude, longitude }). */
export function answerCoords(a: FastFieldAnswer): { lat: number; lng: number } | null {
  const v = a.value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return validCoords(o.latitude ?? o.lat, o.longitude ?? o.lng);
  }
  return null;
}

// ── Facts ─────────────────────────────────────────────────────────────────

const SITE_LABEL =
  /\b(site|premises|property|store|branch|building|address|depot|facility|location)\b/i;
const NOT_SITE_LABEL =
  /\b(gps|map|co-?ordinates?|lat|long|latitude|longitude|customer|stuck|witness)\b/i;
const OFFICER_LABEL =
  /\b(officer|guard|operative|responder|attending|attended|patrol(?:ler|man)?|staff|sia)\b/i;
const NAME_LABEL = /\bname\b/i;
const NOT_PERSON_LABEL =
  /\b(customer|client|company|unit|police|fire|contact|manager|witness|keyholder|stuck)\b/i;
const ARRIVE_LABEL =
  /arriv|on[\s-]?site|attend|\bstart|time\s*in\b|check[\s-]?in|reached/i;
const LEAVE_LABEL =
  /depart|leav|\boff\b|finish|\bend(?:ed)?\b|complet|time\s*out\b|check[\s-]?out|\bexit|\bleft\b/i;
const NOT_VISIT_TIME = /incident|call(?:ed)?\b|call[\s-]?out|alarm|activation|reported|received/i;
const SUMMARY_LABEL =
  /note|observ|incident|issue|comment|detail|descri|report|summary|remark|reason|action/i;
const POSTCODE_LABEL = /post\s*code|address|site|premises|property|location/i;
const VISIT_TYPE_LABEL =
  /\b(type|visit|reason|service|activity|job|call[\s-]?out|attend(?:ance|ed)?\s+for)\b/i;

/** A full UK postcode in free text ("Neasden NW10 7UD", "nw107ud"),
 *  normalised to capitals without spaces. */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function extractPostcode(text: string | null | undefined): string | null {
  const m = text?.match(POSTCODE);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : null;
}

export function normalisePostcode(pc: string | null | undefined): string {
  return (pc ?? "").replace(/\s+/g, "").toUpperCase();
}

/** What kind of visit a form says it was, from a short "type"-style answer
 *  ("Lock up", "Unlock", "Call out", "Patrol"). Null when it doesn't say. */
export function visitTypeOf(answers: FastFieldAnswer[]): string | null {
  for (const a of answers) {
    if (answerKind(a.type) !== "text" || !VISIT_TYPE_LABEL.test(a.label)) continue;
    const v = answerText(a.value);
    if (!v || v.length > 40) continue;
    if (/\bun-?lock/i.test(v)) return "UNLOCK";
    if (/\block(?:[\s-]?up|ing)?\b/i.test(v)) return "LOCK";
    if (/patrol/i.test(v)) return "PATROL";
    if (/call[\s-]?out|alarm|activation|response/i.test(v)) return "ALARM_RESPONSE";
    if (/key/i.test(v) && /collect/i.test(v)) return "KEY_COLLECTION";
  }
  return null;
}

/** Reasonable bounds for a typed arrival/departure, relative to submission
 *  (forms can be finished offline and sent later). */
const TYPED_BEFORE_SUBMIT_MS = 72 * 60 * 60 * 1000;
/** The phone's own "form opened" time is trusted further back. */
const OPENED_BEFORE_SUBMIT_MS = 7 * 24 * 60 * 60 * 1000;
const AFTER_SUBMIT_MS = 60 * 60 * 1000;

export type FastFieldFacts = {
  siteText: string | null;
  officerText: string | null;
  /** The officer text without any SIA licence number. */
  officerName: string | null;
  /** A 16-digit SIA licence number found in the officer text. */
  siaNumber: string | null;
  /** From the form's arrival / departure fields (null when not given). */
  arrivedAt: Date | null;
  departedAt: Date | null;
  /** When the form was opened / finished on the phone, if plausible. */
  openedAt: Date | null;
  closedAt: Date | null;
  /** The moment used to find the activity: arrival, else form opened,
   *  else submitted. */
  when: Date;
  lat: number | null;
  lng: number | null;
  /** First written note — shown on the admin list to help linking by hand. */
  summary: string | null;
  /** A UK postcode typed in the site name (or a postcode/address answer). */
  postcode: string | null;
  /** What the form says the visit was (LOCK, UNLOCK, PATROL, …), if it does. */
  visitType: string | null;
};

export type FactsInput = {
  submittedAt: string | Date;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  answers: FastFieldAnswer[];
};

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  return parseFastFieldTime(v) ?? (Number.isFinite(new Date(v).getTime()) ? new Date(v) : null);
}

/** Pull a 16-digit SIA licence number out of free text. */
export function splitSiaNumber(text: string): { name: string | null; sia: string | null } {
  const m = text.match(/(?:\d[\s-]?){15}\d/);
  const sia = m ? m[0].replace(/\D/g, "") : null;
  const name = (m ? text.replace(m[0], " ") : text)
    .replace(/\b(sia|licen[cs]e|lic|no|number|badge)\b\.?/gi, " ")
    .replace(/[/|:#()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name: name || null, sia: sia && sia.length === 16 ? sia : null };
}

export function extractFacts(input: FactsInput): FastFieldFacts {
  const answers = input.answers ?? [];
  const submittedAt = toDate(input.submittedAt) ?? new Date();
  const startedAt = toDate(input.startedAt ?? null);
  const finishedAt = toDate(input.finishedAt ?? null);

  const textAnswers = answers.filter((a) => answerKind(a.type) === "text");
  const textOf = (a: FastFieldAnswer) => answerText(a.value);

  // Site: the first text answer labelled like a site/premises.
  const siteAnswer = textAnswers.find(
    (a) =>
      SITE_LABEL.test(a.label) &&
      !NOT_SITE_LABEL.test(a.label) &&
      !OFFICER_LABEL.test(a.label) &&
      textOf(a),
  );

  // Officer: an "officer/guard/SIA" label wins over a bare "… name".
  const personish = textAnswers.filter(
    (a) => a !== siteAnswer && !NOT_PERSON_LABEL.test(a.label) && textOf(a),
  );
  const officerAnswer =
    personish.find((a) => OFFICER_LABEL.test(a.label)) ??
    personish.find((a) => NAME_LABEL.test(a.label) && !SITE_LABEL.test(a.label));

  const officerText = officerAnswer ? textOf(officerAnswer) : null;
  const { name: officerName, sia: siaNumber } = officerText
    ? splitSiaNumber(officerText)
    : { name: null, sia: null };

  // Arrival / departure from the labelled time fields, kept only when they're
  // plausible for this submission (not a default date picked by mistake).
  const within = (d: Date | null, beforeMs: number) =>
    d &&
    d.getTime() >= submittedAt.getTime() - beforeMs &&
    d.getTime() <= submittedAt.getTime() + AFTER_SUBMIT_MS
      ? d
      : null;
  const timed = answers
    .filter((a) => answerKind(a.type) === "date")
    .map((a) => ({ a, t: within(answerTime(a), TYPED_BEFORE_SUBMIT_MS) }))
    .filter((x): x is { a: FastFieldAnswer; t: Date } => !!x.t);

  let arrivedAt =
    timed.find((x) => ARRIVE_LABEL.test(x.a.label) && !LEAVE_LABEL.test(x.a.label))?.t ??
    null;
  let departedAt = timed.find((x) => LEAVE_LABEL.test(x.a.label))?.t ?? null;
  if (!arrivedAt && !departedAt) {
    // Unlabelled times: first = arrival, last = departure — but never an
    // incident / call-received time.
    const visitTimes = timed.filter((x) => !NOT_VISIT_TIME.test(x.a.label));
    if (visitTimes.length >= 2) {
      arrivedAt = visitTimes[0].t;
      departedAt = visitTimes[visitTimes.length - 1].t;
    }
  }
  if (arrivedAt && departedAt && departedAt.getTime() < arrivedAt.getTime()) {
    departedAt = null;
  }

  // GPS: a location answer first, else wherever a field captured the phone.
  let coords: { lat: number; lng: number } | null = null;
  for (const a of answers) {
    if (answerKind(a.type) === "location") {
      coords = answerCoords(a);
      if (coords) break;
    }
  }
  if (!coords) {
    for (const a of answers) {
      coords = validCoords(a.lat, a.lng);
      if (coords) break;
    }
  }

  const summaryAnswer = textAnswers.find(
    (a) =>
      a !== siteAnswer &&
      a !== officerAnswer &&
      SUMMARY_LABEL.test(a.label) &&
      (textOf(a)?.length ?? 0) >= 3,
  );
  const summary = summaryAnswer ? textOf(summaryAnswer)!.slice(0, 280) : null;
  const openedAt = within(startedAt, OPENED_BEFORE_SUBMIT_MS);
  const closedAt = within(finishedAt, OPENED_BEFORE_SUBMIT_MS);
  const siteText = siteAnswer ? textOf(siteAnswer) : null;
  const postcode =
    extractPostcode(siteText) ??
    textAnswers
      .filter((a) => a !== officerAnswer && POSTCODE_LABEL.test(a.label))
      .map((a) => extractPostcode(textOf(a)))
      .find((pc): pc is string => !!pc) ??
    null;

  return {
    siteText,
    officerText,
    officerName,
    siaNumber,
    arrivedAt,
    departedAt,
    openedAt,
    closedAt,
    when: arrivedAt ?? openedAt ?? submittedAt,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    summary,
    postcode,
    visitType: visitTypeOf(answers),
  };
}

// ── Site ──────────────────────────────────────────────────────────────────

export type SiteRow = SiteCandidate & {
  lat: number | null;
  lng: number | null;
  customerId?: string | null;
};

export type SiteHow =
  | "postcode"
  | "postcode+name"
  | "postcode+gps"
  | "name"
  | "name+gps"
  | "gps"
  | "activity";

export type SitePick =
  | { site: SiteRow; how: SiteHow; distanceM: number | null }
  /** `candidates`: the sites it could be — those the postcode or name fits,
   *  or those near the GPS fix — for pickSiteByActivity. */
  | { site: null; reason: string; candidates: SiteRow[] };

/** Within this distance a GPS fix alone identifies the site. */
export const GPS_ONLY_MAX_M = 500;
/** Within this distance GPS settles a name that fits several sites. */
export const GPS_TIEBREAK_MAX_M = 2000;

function distanceTo(site: SiteRow, lat: number | null, lng: number | null): number | null {
  if (lat == null || lng == null || site.lat == null || site.lng == null) return null;
  return haversineMeters(lat, lng, site.lat, site.lng);
}

/** Sites within `maxM` of the fix, nearest first. */
function within(sites: SiteRow[], lat: number | null, lng: number | null, maxM: number): SiteRow[] {
  return sites
    .map((site) => ({ site, d: distanceTo(site, lat, lng) }))
    .filter((x): x is { site: SiteRow; d: number } => x.d != null && x.d <= maxM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.site);
}

function nearest(
  sites: SiteRow[],
  lat: number | null,
  lng: number | null,
  maxM: number,
): { site: SiteRow; distanceM: number } | null {
  let best: { site: SiteRow; distanceM: number } | null = null;
  for (const s of sites) {
    const d = distanceTo(s, lat, lng);
    if (d != null && d <= maxM && (!best || d < best.distanceM)) {
      best = { site: s, distanceM: d };
    }
  }
  return best;
}

export type CustomerRow = { id: string; name: string };

/** Words every self-storage site shares — they don't tell sites apart, and
 *  would make every "Access Self Storage …" outscore "Woolwich (SH-74)". */
const SHARED_WORDS = new Set(["self", "storage", "selfstorage"]);

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The typed site name, ready for matching: a client named in it ("Shurgard
 * self storage Woolwich") narrows the search to that client's sites, and the
 * client's name and the words every storage site shares come out of the
 * text — leaving "woolwich" to find "Woolwich (SH-74)". Two clients named,
 * or none: no narrowing.
 */
export function narrowSiteText(
  text: string | null,
  sites: SiteRow[],
  customers: CustomerRow[],
): { text: string | null; pool: SiteRow[] } {
  if (!text) return { text, pool: sites };
  let ws = wordsOf(text);
  const named = customers.filter((c) => {
    const cw = wordsOf(c.name);
    if (cw.join(" ").length < 3) return false;
    for (let i = 0; i + cw.length <= ws.length; i++) {
      if (cw.every((w, j) => ws[i + j] === w)) return true;
    }
    return false;
  });
  let pool = sites;
  if (named.length === 1) {
    const own = sites.filter((x) => x.customerId === named[0].id);
    if (own.length) pool = own;
    const cw = new Set(wordsOf(named[0].name));
    ws = ws.filter((w) => !cw.has(w));
  }
  ws = ws.filter((w) => !SHARED_WORDS.has(w));
  return { text: ws.length ? ws.join(" ") : null, pool };
}

/**
 * Which site a report is for. A postcode in the site name (or a postcode
 * answer) wins; otherwise the site named in the form (fuzzy, like the
 * Telegram bot) — among the named client's sites when the text names one.
 * The phone's GPS settles a postcode or name that fits several sites, and
 * stands in when neither is recognised.
 */
export function pickSite(
  report: { siteText: string | null; postcode?: string | null; lat: number | null; lng: number | null },
  allSites: SiteRow[],
  customers: CustomerRow[] = [],
): SitePick {
  const { siteText, postcode, lat, lng } = report;
  // The name without the postcode, so its parts don't count as name words.
  const typed = siteText?.replace(POSTCODE, " ").replace(/\s+/g, " ").trim() || null;
  const { text: nameText, pool: sites } = narrowSiteText(typed, allSites, customers);

  if (postcode) {
    const anyHits = allSites.filter((s) => normalisePostcode(s.postcode) === postcode);
    // The named client's sites at that postcode, if it has any there.
    const ownHits = anyHits.filter((s) => sites.includes(s));
    const hits = ownHits.length ? ownHits : anyHits;
    if (hits.length === 1) {
      return { site: hits[0], how: "postcode", distanceM: distanceTo(hits[0], lat, lng) };
    }
    if (hits.length > 1) {
      const byName = nameText ? matchSite(nameText, hits) : null;
      if (byName?.kind === "one") {
        const site = byName.site as SiteRow;
        return { site, how: "postcode+name", distanceM: distanceTo(site, lat, lng) };
      }
      const near = nearest(hits, lat, lng, GPS_TIEBREAK_MAX_M);
      if (near) return { site: near.site, how: "postcode+gps", distanceM: near.distanceM };
      return {
        site: null,
        reason: `Postcode ${postcode} fits ${hits.length} sites — pick the right one.`,
        candidates: hits,
      };
    }
  }

  if (nameText) {
    const m = matchSite(nameText, sites);
    if (m.kind === "one") {
      const site = m.site as SiteRow;
      return { site, how: "name", distanceM: distanceTo(site, lat, lng) };
    }
    if (m.kind === "many") {
      // A site whose NAME has every word beats one that only has them in
      // its address ("Woolwich" vs a site on Woolwich Road).
      const want = wordsOf(nameText);
      const byName = (m.sites as SiteRow[]).filter((x) => {
        const words = wordsOf(x.name);
        const name = words.join(" ");
        // Numbers and filler must be whole words: "site 1" isn't "site 12".
        return want.every((w) => (isWeakWord(w) ? words.includes(w) : name.includes(w)));
      });
      if (byName.length === 1) {
        return { site: byName[0], how: "name", distanceM: distanceTo(byName[0], lat, lng) };
      }
      const near = nearest(m.sites as SiteRow[], lat, lng, GPS_TIEBREAK_MAX_M);
      if (near) return { site: near.site, how: "name+gps", distanceM: near.distanceM };
      return {
        site: null,
        reason: `“${siteText}” fits ${m.sites.length} sites — pick the right one.`,
        candidates: m.sites as SiteRow[],
      };
    }
  }
  const near = nearest(sites, lat, lng, GPS_ONLY_MAX_M);
  if (near) return { site: near.site, how: "gps", distanceM: near.distanceM };
  const nearby = within(sites, lat, lng, GPS_TIEBREAK_MAX_M);
  if (siteText) return { site: null, reason: `Site “${siteText}” not recognised.`, candidates: nearby };
  return {
    site: null,
    reason: "The form doesn't say which site, and has no GPS fix near one.",
    candidates: nearby,
  };
}

/** Beyond this, the phone's GPS fix rules a site out even when it had work on. */
export const ACTIVITY_SITE_MAX_M = 5000;

/**
 * When the form's site fits several sites — or none, but the phone was near
 * some — the one that had work on at the time (a static shift, or a job or
 * visit within 3 hours). Only when exactly one did, and it isn't far from the
 * phone's GPS fix.
 */
export function pickSiteByActivity(
  report: { lat: number | null; lng: number | null },
  candidates: SiteRow[],
  activeSiteIds: Set<string>,
): SiteRow | null {
  const active = candidates.filter((c) => activeSiteIds.has(c.id));
  if (active.length !== 1) return null;
  const d = distanceTo(active[0], report.lat, report.lng);
  return d != null && d > ACTIVITY_SITE_MAX_M ? null : active[0];
}

// ── Officer ───────────────────────────────────────────────────────────────

export type PersonRow = { id: string; name: string; siaNumber: string | null };

/** The member of staff named in the form: by SIA licence number first, then
 *  by name. Null unless exactly one person fits. */
export function pickOfficer(facts: FastFieldFacts, people: PersonRow[]): string | null {
  if (facts.siaNumber) {
    const bySia = people.filter(
      (p) => p.siaNumber && p.siaNumber.replace(/\D/g, "") === facts.siaNumber,
    );
    if (bySia.length === 1) return bySia[0].id;
  }
  const name = facts.officerName ?? facts.officerText;
  if (!name) return null;
  const m = matchPerson(name, people);
  return m.kind === "one" ? m.person.id : null;
}

// ── Shift ─────────────────────────────────────────────────────────────────

export type ShiftCandidate = {
  id: string;
  /** Earliest of the scheduled / actual start, latest of the ends. */
  start: Date;
  end: Date;
  officerId: string | null;
};

/** A report this long before a shift starts, or after it ends, still counts. */
export const SHIFT_EARLY_MIN = 30;
export const SHIFT_LATE_MIN = 60;

/** Shifts at the site that were on at the report's time. */
export function shiftsOn(when: Date, shifts: ShiftCandidate[]): ShiftCandidate[] {
  const t = when.getTime();
  return shifts.filter(
    (s) =>
      t >= s.start.getTime() - SHIFT_EARLY_MIN * 60000 &&
      t <= s.end.getTime() + SHIFT_LATE_MIN * 60000,
  );
}

/**
 * The static / dog-handler shift a patrol report was filed during: the one on
 * at the time, or — if two were — the one worked by the officer named in the
 * form, else the one that started first (`shared`). A shift takes any number
 * of reports (one per patrol round), and linking one changes no billing.
 */
export function pickShift(
  when: Date,
  shifts: ShiftCandidate[],
  officerId: string | null,
): { pick: ShiftCandidate; shared: boolean } | { pick: null; reason: "none" } {
  const on = shiftsOn(when, shifts);
  if (on.length === 0) return { pick: null, reason: "none" };
  if (on.length === 1) return { pick: on[0], shared: false };
  const theirs = officerId ? on.filter((s) => s.officerId === officerId) : [];
  if (theirs.length === 1) return { pick: theirs[0], shared: false };
  const pool = theirs.length > 1 ? theirs : on;
  const first = [...pool].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id),
  )[0];
  return { pick: first, shared: true };
}

/** With no shift on, a patrol report this long before a shift starts — or
 *  after it ends (rounds sent in late) — still goes to that shift. */
export const SHIFT_AROUND_EARLY_MIN = 120;
export const SHIFT_AROUND_LATE_MIN = 360;

/** The shift a patrol report filed just outside it belongs to: the nearest
 *  one, within the margins above. */
export function shiftAround(
  when: Date,
  shifts: ShiftCandidate[],
): { pick: ShiftCandidate; gapMin: number; after: boolean } | null {
  const t = when.getTime();
  let best: { s: ShiftCandidate; gap: number; after: boolean } | null = null;
  for (const sh of shifts) {
    const before = sh.start.getTime() - t;
    const after = t - sh.end.getTime();
    let gap = 0;
    let isAfter = false;
    if (before > 0) {
      if (before > SHIFT_AROUND_EARLY_MIN * 60000) continue;
      gap = before;
    } else if (after > 0) {
      if (after > SHIFT_AROUND_LATE_MIN * 60000) continue;
      gap = after;
      isAfter = true;
    }
    if (
      !best ||
      gap < best.gap ||
      (gap === best.gap && sh.start.getTime() < best.s.start.getTime())
    ) {
      best = { s: sh, gap, after: isAfter };
    }
  }
  return best ? { pick: best.s, gapMin: Math.round(best.gap / 60000), after: best.after } : null;
}

// ── Activity ──────────────────────────────────────────────────────────────

export type ActivityCandidate = {
  kind: "job" | "visit";
  id: string;
  /** JobType, or "PATROL" for a patrol visit. */
  type: string;
  /** Every time the activity records (scheduled, started, completed, …). */
  times: Date[];
  /** Already has a FastField report attached. */
  taken: boolean;
};

export type ActivityPick =
  /** `closeCall`: another activity was about as close (it took the form's
   *  own kind of work, then the nearer one). */
  | { pick: ActivityCandidate; minutesApart: number; closeCall: boolean }
  | { pick: null; reason: "none" | "taken"; options: ActivityCandidate[] };

/** How far either side of the report an activity may be. */
export const MATCH_WINDOW_MIN = 180;
/** When nothing is that close: how far either side to look for the same kind
 *  of work (a report filed late, or a job logged at the wrong time). */
export const WIDE_MATCH_WINDOW_MIN = 18 * 60;

/** Kinds of work that can stand in for each other. */
export type Family = "patrol" | "callout" | "lock" | "unlock";

export function familyOf(type: string): Family | null {
  switch (type) {
    case "PATROL":
    case "VPI":
      return "patrol";
    case "ALARM_RESPONSE":
    case "ADHOC":
    case "KEY_COLLECTION":
    case "KEY_DROPOFF":
    case "SURVEY":
      return "callout";
    case "LOCK":
      return "lock";
    case "UNLOCK":
      return "unlock";
    default:
      return null;
  }
}

/** An activity of the form's own type counts as this much closer. */
const SAME_TYPE_BONUS_MIN = 30;
/** A runner-up within this much of the winner is "about as close". */
const CLEAR_MARGIN_MIN = 20;

/** "45 min" / "5 h 10 min" — how far apart a report and an activity are. */
export function apartText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function minutesApart(c: ActivityCandidate, when: Date): number {
  let best = Number.POSITIVE_INFINITY;
  for (const t of c.times) {
    const m = Math.abs(t.getTime() - when.getTime()) / 60000;
    if (m < best) best = m;
  }
  return best;
}

/**
 * The activity a report belongs to: the nearest in time at the site, within
 * 3 hours either side (or `windowMin`), preferring the form's own type when
 * two are close. When two are about equally close it still decides — the
 * form's own kind of work, then the nearer, then the earlier. Leaves it for a
 * person only when the activities nearby already have a FastField report.
 */
export function pickActivity(
  when: Date,
  formJobType: string,
  candidates: ActivityCandidate[],
  windowMin: number = MATCH_WINDOW_MIN,
): ActivityPick {
  const near = candidates
    .map((c) => ({ c, m: minutesApart(c, when) }))
    .filter((x) => x.m <= windowMin);
  const free = near
    .filter((x) => !x.c.taken)
    .map((x) => ({ ...x, score: x.m - (x.c.type === formJobType ? SAME_TYPE_BONUS_MIN : 0) }))
    .sort((a, b) => a.score - b.score);

  if (free.length === 0) {
    return {
      pick: null,
      reason: near.length ? "taken" : "none",
      options: near.map((x) => x.c),
    };
  }
  const close = free.filter((x) => x.score - free[0].score < CLEAR_MARGIN_MIN);
  close.sort(
    (a, b) =>
      Number(b.c.type === formJobType) - Number(a.c.type === formJobType) ||
      a.m - b.m ||
      firstTime(a.c) - firstTime(b.c) ||
      a.c.id.localeCompare(b.c.id),
  );
  return {
    pick: close[0].c,
    minutesApart: Math.round(close[0].m),
    closeCall: close.length > 1,
  };
}

function firstTime(c: ActivityCandidate): number {
  return Math.min(...c.times.map((t) => t.getTime()));
}

/**
 * The fallback when nothing at the site is within 3 hours: the nearest
 * activity of the same kind of work (patrol or VPI, callout, lock-up, unlock)
 * within 18 hours either side. Only ones without a FastField report that were
 * already due by `now`, so a report never completes tonight's patrol early.
 */
export function pickActivityWide(
  when: Date,
  formJobType: string,
  candidates: ActivityCandidate[],
  now: Date,
): ActivityPick {
  const family = familyOf(formJobType);
  const fits = candidates.filter(
    (c) =>
      family != null &&
      familyOf(c.type) === family &&
      !c.taken &&
      c.times.some((t) => t.getTime() <= now.getTime()),
  );
  return pickActivity(when, formJobType, fits, WIDE_MATCH_WINDOW_MIN);
}
