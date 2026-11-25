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
import { formatDateTime, formatTime, ukDayString, ukWallClockToUtc } from "@/lib/dates";
import { haversineMeters } from "@/lib/geo";
import {
  isWeakWord,
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
  /** When the officer filled this field in (fields set to capture it). Never
   *  read as a time: only what was typed counts (typedValue). */
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
  // Yes / No / N/A: FastField's ThreeState (a "tri-state") — not every type
  // with "tri" in it ("StringEntry", "Matrix").
  if (/^(?:three|tri)[\s_-]?state/.test(t)) return "tri";
  // Typed or chosen text: entries, lists and lookups, and radio buttons,
  // check boxes and drop-downs, whose answer is the option picked.
  if (/entry|text|alpha|list|lookup|picker|barcode|email|phone|radio|check[\s_-]?box|choice|select|dropdown/.test(t)) {
    return "text";
  }
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

/** A UK calendar day. */
export type UkDay = { year: number; month: number; day: number };
type Clock = { h: number; mi: number; s: number; ms: number };
type DateTimeParts = {
  day: UkDay;
  time: Clock | null;
  /** Minutes ahead of UTC, when the value gives a zone ("Z", "+01:00"). */
  zoneMin: number | null;
};

// "22:15", "22:15:00.000", "6:20 pm".
const CLOCK = String.raw`(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:\s*([ap])\.?m\.?)?`;
const ISO_VALUE = new RegExp(
  String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})(?:(?:T|\s+)${CLOCK}\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$`,
  "i",
);
const UK_VALUE = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:(?:T|,?\s+)${CLOCK})?$`, "i");
const CLOCK_VALUE = new RegExp(String.raw`^${CLOCK}$`, "i");

function clockOf(h: string, mi: string, s?: string, frac?: string, ap?: string): Clock | null {
  let hour = Number(h);
  const minute = Number(mi);
  const second = s ? Number(s) : 0;
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (/p/i.test(ap) ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { h: hour, mi: minute, s: second, ms: frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0 };
}

function dayOf(y: string, m: string, d: string): UkDay | null {
  const [year, month, day] = [Number(y), Number(m), Number(d)];
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/** The UK calendar day a moment falls on. */
function ukDayOf(d: Date): UkDay {
  const [year, month, day] = ukDayString(d).split("-").map(Number);
  return { year, month, day };
}

/** The calendar day `n` days after `day`. */
function addDays(day: UkDay, n: number): UkDay {
  const t = new Date(Date.UTC(day.year, day.month - 1, day.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** A UK wall-clock time on a UK day, as a moment. */
function atUk(day: UkDay, t: Pick<Clock, "h" | "mi" | "s">): Date {
  return ukWallClockToUtc(day.year, day.month, day.day, t.h, t.mi, t.s);
}

/** "2026-10-17T22:15:00.000+01:00", "2026-10-17 22:15", "2026-10-17",
 *  "17/10/2026 22:15" in parts; null for anything else. */
function dateTimeParts(v: string): DateTimeParts | null {
  const iso = v.match(ISO_VALUE);
  const m = iso ?? v.match(UK_VALUE);
  if (!m) return null;
  const day = iso ? dayOf(m[1], m[2], m[3]) : dayOf(m[3], m[2], m[1]);
  if (!day) return null;
  if (m[4] == null) return { day, time: null, zoneMin: null };
  const time = clockOf(m[4], m[5], m[6], m[7], m[8]);
  if (!time) return null;
  const zone = iso?.[9]?.match(/^([+-])(\d{2}):?(\d{2})?$/);
  const zoneMin = !iso?.[9]
    ? null
    : zone
      ? (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3] ?? 0))
      : 0; // "Z"
  return { day, time, zoneMin };
}

function momentOf(p: DateTimeParts, t: Clock): Date {
  if (p.zoneMin == null) return new Date(atUk(p.day, t).getTime() + t.ms);
  const utc = new Date(0);
  utc.setUTCFullYear(p.day.year, p.day.month - 1, p.day.day);
  utc.setUTCHours(t.h, t.mi, t.s, t.ms);
  return new Date(utc.getTime() - p.zoneMin * 60000);
}

/**
 * FastField times arrive as ISO strings, normally with an offset
 * ("2026-10-17T22:15:00.000+01:00"), with a "T" or a space before the time.
 * One without a zone is read as UK wall-clock time, not the server's UTC (on
 * the nights the clocks change, as `ukWallClockToUtc` reads it). A UK
 * day-first date ("17/10/2026 22:15") is read too. Only a full date and time
 * is a moment: a date or a time on its own gives null (see `typedValue`).
 */
export function parseFastFieldTime(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const p = dateTimeParts(s.trim());
  return p?.time ? momentOf(p, p.time) : null;
}

/** A date / time answer as the officer typed it: a full moment, a day with no
 *  time, or a time of day with no day. */
export type TypedValue =
  | { kind: "moment"; at: Date }
  | { kind: "date"; day: UkDay }
  | ({ kind: "time" } & Clock);

/** Before this year a date is FastField's placeholder for a time typed on
 *  its own ("1900-01-01T06:20:00"), not a day anyone picked. */
const PLACEHOLDER_YEAR_BEFORE = 2000;

/** A label that asks for a date and not a time ("Date", "Date of patrol"). */
function isDateLabel(label: string): boolean {
  return /\bdate\b/i.test(label) && !/\btime|\bhrs?\b|o'?clock/i.test(label);
}

/**
 * What a date picker's or time picker's value says, as typed: a full date
 * and time is that moment (no zone = UK time); "06:20", or a time on a
 * placeholder date, is a time of day only; "2026-11-24" is a day only — as is
 * a midnight under a label that asks for a date, the way a date picker can
 * keep a day. Null when it's none of these. When the field was tapped on the
 * phone (`at`) is never used.
 */
export function typedValue(a: Pick<FastFieldAnswer, "label" | "value">): TypedValue | null {
  if (typeof a.value !== "string") return null;
  const v = a.value.trim();
  const c = v.match(CLOCK_VALUE);
  if (c) {
    const t = clockOf(c[1], c[2], c[3], c[4], c[5]);
    return t ? { kind: "time", ...t } : null;
  }
  const p = dateTimeParts(v);
  if (!p) return null;
  if (!p.time) return { kind: "date", day: p.day };
  if (p.day.year < PLACEHOLDER_YEAR_BEFORE) return { kind: "time", ...p.time };
  const at = momentOf(p, p.time);
  if (isDateLabel(a.label)) {
    const t = p.time;
    if (t.h === 0 && t.mi === 0 && t.s === 0 && t.ms === 0) return { kind: "date", day: p.day };
    const ukDay = ukDayOf(at);
    if (atUk(ukDay, { h: 0, mi: 0, s: 0 }).getTime() === at.getTime()) return { kind: "date", day: ukDay };
  }
  return { kind: "moment", at };
}

/**
 * The moment an answer's typed value gives (typedValue). A time typed without
 * a date goes on `day` (a date typed in the same form) when given, else on
 * the UK day it was sent (`submittedAt`) — the day before if that would be
 * more than 15 minutes after it was sent (placeTime). A day on its own is no
 * moment. When the field was tapped on the phone never counts.
 */
export function answerTime(
  a: FastFieldAnswer,
  ctx: { submittedAt?: Date | null; day?: UkDay | null } = {},
): Date | null {
  const v = typedValue(a);
  if (!v || v.kind === "date") return null;
  return v.kind === "moment" ? v.at : placeTime(v, ctx.day ?? null, ctx.submittedAt ?? null);
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
/** A site word in a label that asks about something else: the phone's
 *  position; someone else's details; something at the site ("Staff on site?",
 *  "Damage to property"); or notes, checks and codes about it ("Site notes",
 *  "Building secure?", "Alarm location"). */
const NOT_SITE_LABEL =
  /\b(gps|map|co-?ordinates?|lat|long|latitude|longitude|stuck|witness|keyholders?|police|caller|home|your|notes?|comments?|observations?|issues?|reports?|incident|damage|condition|hazards?|secure|secured|checks?|checked|photos?|keys?|access|alarm|zone|contact|manager|type|reason)\b|\b(on|at|off|in|to|from|around|inside|outside|left|leaving)\s+(the\s+)?(site|premises|property|building|store|location)\b/i;
/** A customer's or client's details — unless it's their site (CLIENT_SITE_LABEL). */
const CUSTOMER_LABEL = /\b(customers?|clients?)\b/i;
const CLIENT_SITE_LABEL =
  /\b(customer|client)(?:'?s)?\s+(site|premises|property|store|branch|building|location)\b/i;
/** Words that make a label the officer's: their name or licence. */
const OFFICER_LABEL = /\b(officer|guard|operative|responder|patroller|patrolman|sia)\b/i;
/** Words that only do so with "by", or with "name" or on their own and with no
 *  site word: "Attended by", "Staff name", "Staff" — not "Site attended",
 *  "Patrol location" or "Patrol notes". */
const OFFICER_HINT = /\b(attending|attended|attendee|patrol|patrolled|staff)\b/i;
const OFFICER_HINTS = new RegExp(OFFICER_HINT.source, "gi");
const NAME_LABEL = /\bname\b/i;
const NOT_PERSON_LABEL =
  /\b(customer|client|company|unit|police|fire|contact|manager|witness|keyholder|stuck)\b/i;
const ARRIVE_LABEL =
  /arriv|attend|on[\s-]?site|reached|\bstart|commenc|time[\s-]*(?:in|on)\b|check(?:ed|ing)?[\s-]?in\b|(?:sign(?:ed|ing)?|book(?:ed|ing)?|clock(?:ed|ing)?|log(?:ged|ging)?)[\s-]?(?:on|in)\b|on[\s-]?duty/i;
const LEAVE_LABEL =
  /depart|leav|\bleft\b|\boff\b|finish|\bend(?:ed|s)?\b|complet|conclu|time[\s-]*out\b|check(?:ed|ing)?[\s-]?out\b|(?:sign(?:ed|ing)?|book(?:ed|ing)?|clock(?:ed|ing)?|log(?:ged|ging)?)[\s-]?(?:off|out)\b|\bexit/i;
/** Someone else's time, or an event's — never the officer's visit, whatever
 *  else the label says ("Time police arrived", "Customer arrived", "Alarm
 *  activation time", "Time of callout"). A client or customer is someone
 *  else only when the time is about them, not where it was ("Arrival at
 *  customer site" is the officer's). */
const NOT_VISIT_TIME =
  /\b(?:police|ambulance|paramedics?|key[\s-]?holders?|engineers?|technicians?|contractors?|managers?)\b|\bfire[\s-]*(?:brigade|services?|crews?|engines?|officers?|department|fighters?|m[ae]n)\b|\bfire\s*(?:&|and)\s*rescue\b|\bemergency\s+services?\b|\b(?:client|customer)s?\b(?!(?:['’]s|['’])?\s*(?:site|premises|property|address|location|building|store|unit|gate)s?\b)|activat|trigger|\balert|\breported\b|receiv|time\s+of\s+(?:the\s+)?call(?:[\s-]?out)?\b|\bcall[\s-]?out\s+time\b/i;
const SUMMARY_LABEL =
  /note|observ|incident|issue|comment|detail|descri|report|summary|remark|reason|action/i;
/** Answers that give the site's postcode or address: "Postcode", "Site
 *  postcode", "Site address", "Address of premises" — not any answer that
 *  mentions a site or location ("Patrol location notes", "Site attended"),
 *  nor someone else's ("Customer address (if stuck on site)"). */
const POSTCODE_LABEL = /\bpost\s*code\b/i;
const SITE_ADDRESS_LABEL =
  /\b(site|premises|property|building|store|branch|depot|facility|location)\b.*\baddress\b|\baddress\b.*\b(site|premises|property|building|store|branch|depot|facility|location)\b/i;
const NOT_SITE_POSTCODE_LABEL =
  /\b(stuck|witness|keyholders?|police|caller|home|your|contact|manager|officer|guard|staff)\b/i;
const VISIT_TYPE_LABEL =
  /\b(type|visit|reason|service|activity|job|call[\s-]?out|attend(?:ance|ed)?\s+for)\b/i;
/** Labels about something else's type, or a reference number: "Property
 *  type: Lock-up unit", "Job number: LOCK-221". */
const NOT_VISIT_TYPE_LABEL =
  /\b(property|premises|building|unit|vehicle|alarm|number|no|ref|reference|id|code)\b/i;

/** A label that names the site: "Site Name", "Site Attended", "Patrol
 *  Location", "Customer site". */
function isSiteLabel(label: string): boolean {
  if (!SITE_LABEL.test(label) || NOT_SITE_LABEL.test(label) || OFFICER_LABEL.test(label)) return false;
  if (OFFICER_HINT.test(label) && /\bby\b/i.test(label)) return false; // "Site attended by"
  return !CUSTOMER_LABEL.test(label) || CLIENT_SITE_LABEL.test(label);
}

/** A label that names the officer: "Officer Name/SIA Number", "Guard",
 *  "Attended by", "Staff name", "Staff". */
function isOfficerLabel(label: string): boolean {
  if (OFFICER_LABEL.test(label)) return true;
  if (!OFFICER_HINT.test(label)) return false;
  if (/\bby\b/i.test(label)) return true;
  if (SITE_LABEL.test(label)) return false;
  return NAME_LABEL.test(label) || !/[a-z]/i.test(label.replace(OFFICER_HINTS, ""));
}

/** Labels for an answer about the officer that isn't their name: "Officer
 *  notes", "Guard signature", "SIA licence checked". */
const NOT_OFFICER_NAME_LABEL =
  /\b(notes?|comments?|observations?|remarks?|reports?|descriptions?|incident|issues?|actions?|checks?|checked|signature|photos?)\b/i;

/** A tick or a yes / no answer — never a site or a person ("Yes", "N/A",
 *  "true" or "1", the value of a check box). */
const YES_NO = /^(?:yes|no|y|n|n\/?a|none|nil|ok|true|false|0|1|-)\.?$/i;
/** Longer than this, an answer is a note, not an officer's name and licence. */
const OFFICER_TEXT_MAX = 80;

/** An answer that gives the site's postcode or address. */
function isSitePostcodeLabel(label: string): boolean {
  if (!POSTCODE_LABEL.test(label) && !SITE_ADDRESS_LABEL.test(label)) return false;
  if (NOT_SITE_POSTCODE_LABEL.test(label)) return false;
  return !CUSTOMER_LABEL.test(label) || CLIENT_SITE_LABEL.test(label);
}

/** A full UK postcode in free text ("Neasden NW10 7UD", "nw107ud"),
 *  normalised to capitals without spaces. */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const POSTCODES = new RegExp(POSTCODE.source, "gi");
/** "Unit B2 3rd floor": "3rd" is an ordinal there, not a postcode's end. */
const ORDINAL = /^\d(?:st|nd|rd|th)$/i;
const FLOOR_AFTER = /^\s*(?:floor|flr|fl|storey|story|level)\b/i;

/** The first real postcode in the text, where it is. */
function findPostcode(text: string): { code: string; index: number; length: number } | null {
  for (const m of text.matchAll(POSTCODES)) {
    const end = (m.index ?? 0) + m[0].length;
    if (ORDINAL.test(m[2]) && FLOOR_AFTER.test(text.slice(end))) continue;
    return { code: `${m[1]}${m[2]}`.toUpperCase(), index: m.index ?? 0, length: m[0].length };
  }
  return null;
}

export function extractPostcode(text: string | null | undefined): string | null {
  return text ? findPostcode(text)?.code ?? null : null;
}

/** The text with its postcode taken out (spaces tidied), null when nothing's left. */
function withoutPostcode(text: string): string | null {
  const pc = findPostcode(text);
  const rest = pc ? `${text.slice(0, pc.index)} ${text.slice(pc.index + pc.length)}` : text;
  return rest.replace(/\s+/g, " ").trim() || null;
}

export function normalisePostcode(pc: string | null | undefined): string {
  return (pc ?? "").replace(/\s+/g, "").toUpperCase();
}

/** A site as typed, cut down to lowercase letters and digits, so spellings
 *  that differ only in case, spaces or punctuation are the same place:
 *  "AB1 2CD", "ab12cd" and "AB12CD" are all "ab12cd". Null when nothing's left.
 *  Skipped places (Admin → FastField) are matched on this. */
export function siteKey(text: string | null | undefined): string | null {
  const k = (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return k || null;
}

export type PlaceGroup = {
  key: string;
  /** The spelling typed most often (the latest one on a tie). */
  label: string;
  count: number;
  /** The site the robot matched them to, if any (the most common). */
  siteName: string | null;
  latest: Date;
};

/** Waiting reports grouped by the site as typed (siteKey), biggest group
 *  first, then the most recent. Reports with no site typed are left out. */
export function groupByPlace(
  rows: { siteText: string | null; submittedAt: Date; siteName: string | null }[],
): PlaceGroup[] {
  const groups = new Map<
    string,
    { spellings: Map<string, { n: number; last: number }>; sites: Map<string, number>; count: number; latest: Date }
  >();
  for (const r of rows) {
    const key = siteKey(r.siteText);
    if (!key) continue;
    const g = groups.get(key) ?? { spellings: new Map(), sites: new Map(), count: 0, latest: r.submittedAt };
    const spelling = r.siteText!.trim().replace(/\s+/g, " ");
    const s = g.spellings.get(spelling) ?? { n: 0, last: 0 };
    s.n++;
    s.last = Math.max(s.last, r.submittedAt.getTime());
    g.spellings.set(spelling, s);
    if (r.siteName) g.sites.set(r.siteName, (g.sites.get(r.siteName) ?? 0) + 1);
    g.count++;
    if (r.submittedAt > g.latest) g.latest = r.submittedAt;
    groups.set(key, g);
  }
  const most = <T,>(m: Map<string, T>, score: (v: T) => [number, number]): string | null => {
    let best: string | null = null;
    let bestScore: [number, number] = [-1, -1];
    for (const [k, v] of m) {
      const sc = score(v);
      if (sc[0] > bestScore[0] || (sc[0] === bestScore[0] && sc[1] > bestScore[1])) {
        best = k;
        bestScore = sc;
      }
    }
    return best;
  };
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: most(g.spellings, (s) => [s.n, s.last]) ?? key,
      count: g.count,
      siteName: most(g.sites, (n) => [n, 0]),
      latest: g.latest,
    }))
    .sort((a, b) => b.count - a.count || b.latest.getTime() - a.latest.getTime());
}

/** What kind of visit a form says it was, from a short "type"-style answer
 *  ("Lock up", "Unlock", "Call out", "Patrol"). Whole words only, so a
 *  reference ("LOCK-221") or a "Property type: Lock-up unit" doesn't count.
 *  Null when it doesn't say. */
export function visitTypeOf(answers: FastFieldAnswer[]): string | null {
  for (const a of answers) {
    if (answerKind(a.type) !== "text" || !VISIT_TYPE_LABEL.test(a.label)) continue;
    if (NOT_VISIT_TYPE_LABEL.test(a.label)) continue;
    const v = answerText(a.value);
    if (!v || v.length > 40) continue;
    // Not followed by a number: "LOCK-221" is a reference, not a lock-up.
    if (/\bun-?lock(?:ing)?\b(?![-/]?\d)/i.test(v)) return "UNLOCK";
    if (/\block(?:[\s-]?up|ing)?\b(?![-/]?\d)/i.test(v)) return "LOCK";
    if (/\bpatrol/i.test(v)) return "PATROL";
    if (/\b(?:call[\s-]?out|alarm|activation|response)/i.test(v)) return "ALARM_RESPONSE";
    if (/\bkeys?\b/i.test(v) && /\bcollect/i.test(v)) return "KEY_COLLECTION";
  }
  return null;
}

// ── Typed times ───────────────────────────────────────────────────────────

/** A typed arrival / departure counts from 72 hours before the report was
 *  sent — reports are often filled in offline and sent later, even days
 *  later … */
const TYPED_BEFORE_SUBMIT_MS = 72 * 60 * 60 * 1000;
/** … to 15 minutes after it. Later than that, the day typed is wrong. */
const TYPED_AFTER_SUBMIT_MS = 15 * 60 * 1000;
/** Typed arrival and departure further apart than this can't both be right. */
const MAX_TYPED_SPAN_MS = 24 * 60 * 60 * 1000;
/** The phone's own opened / finished times (only ever recorded on the
 *  activity when a report is attached) are trusted further back. */
const OPENED_BEFORE_SUBMIT_MS = 7 * 24 * 60 * 60 * 1000;
const OPENED_AFTER_SUBMIT_MS = 60 * 60 * 1000;

/** The arrival / departure words that can only mean the officer was there
 *  (a subset of ARRIVE_LABEL / LEAVE_LABEL) — not "start", "end" or "off",
 *  which an alarm or an incident does too ("Time alarm turned off"). */
const PRESENCE_ARRIVE =
  /arriv|attend|on[\s-]?site|reached|check(?:ed|ing)?[\s-]?in\b|(?:sign(?:ed|ing)?|book(?:ed|ing)?|clock(?:ed|ing)?|log(?:ged|ging)?)[\s-]?(?:on|in)\b|on[\s-]?duty/i;
const PRESENCE_LEAVE =
  /depart|leav|\bleft\b|off[\s-]?site|off[\s-]?duty|check(?:ed|ing)?[\s-]?out\b|(?:sign(?:ed|ing)?|book(?:ed|ing)?|clock(?:ed|ing)?|log(?:ged|ging)?)[\s-]?(?:off|out)\b/i;
/** An alarm, an incident or a phone call: a time under it is the event's
 *  ("Alarm time", "Time alarm turned off", "Incident start time", "Time
 *  called") unless the label says the officer arrived or left ("Arrived at
 *  alarm", "Time attended incident"), or is about the officer's own job — a
 *  callout, their response or attendance ("Alarm callout finish time",
 *  "Time attended (alarm response)"). A callout itself is the officer's job,
 *  not an event ("Callout start time"). */
const EVENT_LABEL = /alarm|incident|\bcalled\b|\bcall(?:s|ing)?\b(?![\s-]*out\b)/i;
const OFFICER_JOB = /\brespon(?:se|ded|ding)\b|\battendance\b|\bcall[\s-]?out/i;

/** What a typed time is: the officer's arrival ("Arrive Date/Time", "Signed
 *  on"), their departure ("Time left site", "Booked off"), a plain visit time
 *  that doesn't say which ("Date/Time of patrol", or both words,
 *  "Start/Finish"), or not the officer's visit at all. */
export type TimeRole = "arrive" | "leave" | "plain" | "not";

/**
 * A typed time's role, by its label. Someone else's time or an event's is
 * never the officer's visit, even with an arrival word ("Time police
 * arrived", "Customer arrived"). Under an alarm, an incident or a call only
 * words that mean the officer was there count ("Arrived at alarm" does,
 * "Time alarm turned off" and "Incident start time" don't).
 */
export function timeRole(label: string): TimeRole {
  if (NOT_VISIT_TIME.test(label)) return "not";
  const eventish = EVENT_LABEL.test(label) && !OFFICER_JOB.test(label);
  const arrive = (eventish ? PRESENCE_ARRIVE : ARRIVE_LABEL).test(label);
  const leave = (eventish ? PRESENCE_LEAVE : LEAVE_LABEL).test(label);
  if (arrive !== leave) return arrive ? "arrive" : "leave";
  return eventish && !arrive ? "not" : "plain";
}

/** A time typed without a date, as a moment: on `day` (a date typed in the
 *  form) when there is one, else on the UK day the report was sent — the day
 *  before if that would be more than 15 minutes after it was sent. */
function placeTime(t: Clock, day: UkDay | null, submittedAt: Date | null): Date | null {
  if (day) return atUk(day, t);
  if (!submittedAt) return null;
  const sent = ukDayOf(submittedAt);
  const sameDay = atUk(sent, t);
  return sameDay.getTime() <= submittedAt.getTime() + TYPED_AFTER_SUBMIT_MS
    ? sameDay
    : atUk(addDays(sent, -1), t);
}

export type FastFieldFacts = {
  siteText: string | null;
  officerText: string | null;
  /** The officer text without any SIA licence number. */
  officerName: string | null;
  /** A 16-digit SIA licence number found in the officer text. */
  siaNumber: string | null;
  /** The officer's arrival and departure, from the times typed in the form.
   *  Null when none was typed, or when the typed times can't be right
   *  (`timesNote` says why) — the send time stands in. */
  arrivedAt: Date | null;
  departedAt: Date | null;
  /** Why the typed times weren't used ("Its typed times are more than a day
   *  apart, so the send time was used."); the robot adds it to its note. */
  timesNote?: string | null;
  /** When the form was opened / finished on the phone, if plausible. Only
   *  recorded on the activity when the report is attached (fastfieldImport
   *  `visitTimes`) — never used to decide where it goes (`when`, reportSpan). */
  openedAt: Date | null;
  closedAt: Date | null;
  /** When it was sent from the phone. */
  submittedAt: Date;
  /** The moment that decides where the report goes — the activity near it,
   *  the site's work on at the time, the middle of the list for linking by
   *  hand: the typed arrival, else the typed departure, else the send time.
   *  The start of reportSpan; never the phone's times. */
  when: Date;
  lat: number | null;
  lng: number | null;
  /** First written note — shown on the admin list to help linking by hand. */
  summary: string | null;
  /** A UK postcode typed in the site name (or a site postcode / address answer). */
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

  // Site: the first text answer whose label names the site, and whose answer
  // could be one (not "Yes" or a ticked box).
  const siteAnswer = textAnswers.find((a) => {
    const t = textOf(a);
    return isSiteLabel(a.label) && !!t && !YES_NO.test(t);
  });

  // Officer: a label that names the officer wins over a bare "… name". Never
  // a note about them or a long answer (a name and licence number are short).
  const personish = textAnswers.filter((a) => {
    const t = textOf(a);
    return (
      a !== siteAnswer &&
      !NOT_PERSON_LABEL.test(a.label) &&
      !NOT_OFFICER_NAME_LABEL.test(a.label) &&
      !!t &&
      t.length <= OFFICER_TEXT_MAX &&
      !YES_NO.test(t)
    );
  });
  const officerAnswer =
    personish.find((a) => isOfficerLabel(a.label)) ??
    personish.find((a) => NAME_LABEL.test(a.label) && !SITE_LABEL.test(a.label));

  const officerText = officerAnswer ? textOf(officerAnswer) : null;
  const { name: officerName, sia: siaNumber } = officerText
    ? splitSiaNumber(officerText)
    : { name: null, sia: null };

  // Arrival and departure: only the times typed in the form — never when a
  // field was tapped, or the form was open, on the phone. A time typed
  // without a date goes on a date typed in the form (the first labelled as a
  // date, else the first; never someone else's or an event's), else on the
  // day it was sent (placeTime). A typed time far from when the report was
  // sent is on the wrong day: left out.
  const sent = submittedAt.getTime();
  const nearSent = (d: Date | null, beforeMs: number, afterMs: number) =>
    d && d.getTime() >= sent - beforeMs && d.getTime() <= sent + afterMs ? d : null;
  type VisitTime = { at: Date; role: TimeRole; clock: Clock | null };
  const read = answers
    .filter((a) => answerKind(a.type) === "date")
    .map((a) => ({ label: a.label, v: typedValue(a) }));
  const days = read.flatMap((x) =>
    x.v?.kind === "date" && timeRole(x.label) !== "not" ? [{ label: x.label, day: x.v.day }] : [],
  );
  const formDay = (days.find((x) => /\bdate\b/i.test(x.label)) ?? days[0])?.day ?? null;
  const visitTimes = read
    .flatMap(({ label, v }): VisitTime[] => {
      if (!v || v.kind === "date") return [];
      const role = timeRole(label);
      const at = nearSent(
        v.kind === "moment" ? v.at : placeTime(v, formDay, submittedAt),
        TYPED_BEFORE_SUBMIT_MS,
        TYPED_AFTER_SUBMIT_MS,
      );
      return role !== "not" && at ? [{ at, role, clock: v.kind === "time" ? v : null }] : [];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const withRole = (role: TimeRole) => visitTimes.filter((x) => x.role === role);

  // Labelled times win for their side (the earliest arrival, the latest
  // departure); plain visit times fill a missing side — the earliest for the
  // arrival, the latest for the departure. One time on its own is that moment.
  const plain = withRole("plain");
  let arrival: VisitTime | null = withRole("arrive").at(0) ?? null;
  let departure: VisitTime | null = withRole("leave").at(-1) ?? null;
  const first = plain.at(0);
  const last = plain.at(-1);
  if (!arrival && first && (!departure || first.at.getTime() <= departure.at.getTime())) {
    arrival = first;
  }
  if (!departure && last && last !== arrival && (!arrival || last.at.getTime() >= arrival.at.getTime())) {
    departure = last;
  }
  let arrivedAt: Date | null = arrival?.at ?? null;
  let departedAt: Date | null = departure?.at ?? null;

  // Typed times that can't be right give way to the send time, with a note.
  let timesNote: string | null = null;
  if (arrivedAt && departure && departedAt && departedAt.getTime() < arrivedAt.getTime()) {
    if (departure.clock) {
      // A departure typed as a time only, before the arrival: the next day
      // (a round over midnight).
      const nextDay = atUk(addDays(ukDayOf(departedAt), 1), departure.clock);
      departedAt = nearSent(nextDay, TYPED_BEFORE_SUBMIT_MS, TYPED_AFTER_SUBMIT_MS);
    } else {
      timesNote = "Its typed departure is before its arrival, so the send time was used.";
    }
  }
  if (arrivedAt && departedAt && departedAt.getTime() - arrivedAt.getTime() > MAX_TYPED_SPAN_MS) {
    timesNote = "Its typed times are more than a day apart, so the send time was used.";
  }
  if (timesNote) {
    arrivedAt = null;
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
  const openedAt = nearSent(startedAt, OPENED_BEFORE_SUBMIT_MS, OPENED_AFTER_SUBMIT_MS);
  const closedAt = nearSent(finishedAt, OPENED_BEFORE_SUBMIT_MS, OPENED_AFTER_SUBMIT_MS);
  const siteText = siteAnswer ? textOf(siteAnswer) : null;
  const postcode =
    extractPostcode(siteText) ??
    textAnswers
      .filter((a) => a !== officerAnswer && isSitePostcodeLabel(a.label))
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
    timesNote,
    openedAt,
    closedAt,
    submittedAt,
    when: arrivedAt ?? departedAt ?? submittedAt,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    summary,
    postcode,
    visitType: visitTypeOf(answers),
  };
}

/** A robot note, plus why the report's typed times weren't used when they
 *  weren't (`timesNote`). */
export function withTimesNote(note: string, facts: Pick<FastFieldFacts, "timesNote">): string {
  return facts.timesNote ? `${note} ${facts.timesNote}` : note;
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
   *  or those near the GPS fix — for pickSiteByActivity. None when the name
   *  and the postcode point to different sites: a person picks. */
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

/** What the typed name alone points to: one site, or several. Among several,
 *  the sites with every word in their NAME are the real candidates — a site
 *  that only has them in its address ("Woolwich" vs a site on Woolwich Road)
 *  counts only when none does. */
function sitesByName(nameText: string, sites: SiteRow[]): { site: SiteRow } | { sites: SiteRow[] } | null {
  const m = matchSite(nameText, sites);
  if (m.kind === "one") return { site: m.site as SiteRow };
  if (m.kind === "none") return null;
  const want = wordsOf(nameText);
  const byName = (m.sites as SiteRow[]).filter((x) => {
    const words = wordsOf(x.name);
    const name = words.join(" ");
    // Numbers and filler must be whole words: "site 1" isn't "site 12".
    return want.every((w) => (isWeakWord(w) ? words.includes(w) : name.includes(w)));
  });
  if (byName.length === 1) return { site: byName[0] };
  return { sites: byName.length > 1 ? byName : (m.sites as SiteRow[]) };
}

/** Whether the typed name finds this site by its name or code, not only by
 *  its address ("Unit 4" finding a site on "Unit 4, Mill Lane"). */
function namesSite(nameText: string, site: SiteRow): boolean {
  const typed = wordsOf(nameText);
  const code = wordsOf(site.code ?? "").join(" ");
  if (code && typed.join(" ") === code) return true;
  const own = wordsOf(`${site.name} ${site.code ?? ""}`).join(" ");
  return typed.some((w) => !isWeakWord(w) && own.includes(w));
}

/** The one of a few sites the phone's GPS clearly points to: within the
 *  tie-break distance, with every other one at least twice as far away. */
function clearlyNearest(
  sites: SiteRow[],
  lat: number | null,
  lng: number | null,
): { site: SiteRow; distanceM: number } | null {
  const near = nearest(sites, lat, lng, GPS_TIEBREAK_MAX_M);
  if (!near) return null;
  const clear = sites.every((s) => {
    if (s === near.site) return true;
    const d = distanceTo(s, lat, lng);
    return d != null && d >= 2 * near.distanceM;
  });
  return clear ? near : null;
}

/**
 * Which site a report is for. A postcode in the site name (or a site postcode
 * / address answer) wins; otherwise the site named in the form (fuzzy, like
 * the Telegram bot) — among the named client's sites when the text names one.
 * When the name points to one site and the postcode to another, one of them
 * is wrong: only a clear GPS fix settles it, else a person picks. The phone's
 * GPS settles a postcode or name that fits several sites, and stands in when
 * neither is recognised.
 */
export function pickSite(
  report: { siteText: string | null; postcode?: string | null; lat: number | null; lng: number | null },
  allSites: SiteRow[],
  customers: CustomerRow[] = [],
): SitePick {
  const { siteText, postcode, lat, lng } = report;
  // The name without the postcode, so its parts don't count as name words.
  const typed = siteText ? withoutPostcode(siteText) : null;
  const { text: nameText, pool: sites } = narrowSiteText(typed, allSites, customers);
  const byName = nameText ? sitesByName(nameText, sites) : null;

  if (postcode) {
    const anyHits = allSites.filter((s) => normalisePostcode(s.postcode) === postcode);
    // The named client's sites at that postcode, if it has any there.
    const ownHits = anyHits.filter((s) => sites.includes(s));
    const hits = ownHits.length ? ownHits : anyHits;
    const named = nameText && byName && "site" in byName && namesSite(nameText, byName.site) ? byName.site : null;
    if (named && hits.length && !hits.includes(named)) {
      const near = clearlyNearest([named, ...hits], lat, lng);
      if (near) {
        return { site: near.site, how: near.site === named ? "name+gps" : "postcode+gps", distanceM: near.distanceM };
      }
      const other = hits.length === 1 ? hits[0].name : `${hits.length} sites at ${postcode}`;
      return {
        site: null,
        reason: `The site name and the postcode point to different sites (${named.name}, ${other}) — pick the right one.`,
        // None: the work on at the time mustn't settle it either.
        candidates: [],
      };
    }
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

  if (byName) {
    if ("site" in byName) {
      return { site: byName.site, how: "name", distanceM: distanceTo(byName.site, lat, lng) };
    }
    // GPS settles it among the real candidates only.
    const near = nearest(byName.sites, lat, lng, GPS_TIEBREAK_MAX_M);
    if (near) return { site: near.site, how: "name+gps", distanceM: near.distanceM };
    return {
      site: null,
      reason: `“${siteText}” fits ${byName.sites.length} sites — pick the right one.`,
      candidates: byName.sites,
    };
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

export type OfficerMatch =
  | { kind: "one"; person: PersonRow }
  /** Several people fit: nobody is guessed. */
  | { kind: "many"; people: PersonRow[] }
  | { kind: "none" };

type OfficerFacts = Pick<FastFieldFacts, "siaNumber" | "officerName" | "officerText">;

/** Titles and the job itself say nothing about who it was ("Officer A Khan"). */
const NOT_NAME_WORDS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "officer", "guard", "security"]);

/** A name as lowercase words, without accents or apostrophes ("O'Brien" is
 *  "obrien", "José" is "jose"); a hyphenated name is two words. */
function personWords(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every typed word is a different one of the person's names: the whole
 *  word, or for a single letter (an initial) a name starting with it. */
function namesFit(want: string[], names: string[]): boolean {
  const left = [...names];
  // Whole words first, so an initial can't use up the name a word needs.
  const order = [...want.filter((w) => w.length > 1), ...want.filter((w) => w.length === 1)];
  for (const w of order) {
    const i = w.length > 1 ? left.indexOf(w) : left.findIndex((n) => n.startsWith(w));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/**
 * A name typed in a FastField form against the staff list, by whole words —
 * unlike the Telegram bot's matchPerson, which also matches parts of words.
 * Every typed word must be one of the person's names, so "Ali" is Ali Khan or
 * Mo Ali but never Natalie, and "Sam Taylor" isn't Sam Jones. A single letter
 * is an initial ("A. Khan" is Ahmed Khan when he's the only one it fits); a
 * name of initials alone fits nobody. The exact full name counts first.
 * Several people fit → "many".
 */
export function matchOfficerName(typed: string, people: PersonRow[]): OfficerMatch {
  const want = personWords(typed).filter((w) => !NOT_NAME_WORDS.has(w) && !/^\d+$/.test(w));
  if (!want.some((w) => w.length > 1)) return { kind: "none" };
  const full = want.join(" ");
  const exact = people.filter((p) => personWords(p.name).join(" ") === full);
  const fits = exact.length ? exact : people.filter((p) => namesFit(want, personWords(p.name)));
  if (fits.length === 1) return { kind: "one", person: fits[0] };
  return fits.length ? { kind: "many", people: fits } : { kind: "none" };
}

/** The member of staff named in the form: by SIA licence number first (only
 *  when exactly one person has it), then by name (matchOfficerName). */
export function matchOfficer(facts: OfficerFacts, people: PersonRow[]): OfficerMatch {
  if (facts.siaNumber) {
    const bySia = people.filter(
      (p) => p.siaNumber && p.siaNumber.replace(/\D/g, "") === facts.siaNumber,
    );
    if (bySia.length === 1) return { kind: "one", person: bySia[0] };
  }
  const name = facts.officerName ?? facts.officerText;
  return name ? matchOfficerName(name, people) : { kind: "none" };
}

/** The id of the one member of staff named in the form. Null when nobody fits
 *  — or several do. */
export function pickOfficer(facts: OfficerFacts, people: PersonRow[]): string | null {
  const m = matchOfficer(facts, people);
  return m.kind === "one" ? m.person.id : null;
}

// ── Shift ─────────────────────────────────────────────────────────────────

export type ShiftCandidate = {
  id: string;
  /** Earliest of the scheduled / actual start, latest of the ends. */
  start: Date;
  end: Date;
  officerId: string | null;
  /** The rota's own times, when known — only to choose between shifts a
   *  report fits equally well (a stale clock-out can stretch start/end). */
  scheduled?: { start: Date; end: Date };
};

/** The time a report covers: from `from` to `to` (the same moment when the
 *  form gives only one time). */
export type ReportSpan = { from: Date; to: Date };

/**
 * A report's own time, for fitting it to a shift: only the times typed in
 * the form — from the arrival to the departure (one moment when only one is
 * typed), the officer's account of when the round was done. When and how
 * long the form was open on the phone never counts. A form with no usable
 * time typed (none at all, or typed times that can't be right — see
 * extractFacts) falls back to when it was sent, the only time left. It
 * starts at the report's `when`.
 */
export function reportSpan(
  f: Pick<FastFieldFacts, "arrivedAt" | "departedAt" | "submittedAt">,
): ReportSpan {
  if (!f.arrivedAt && !f.departedAt) return { from: f.submittedAt, to: f.submittedAt };
  const from = (f.arrivedAt ?? f.departedAt)!;
  const to = f.departedAt ?? from;
  return { from, to: to.getTime() < from.getTime() ? from : to };
}

/** "17 Nov, 23:50–00:10" — a report's time for people (the date once, and
 *  just the one time when the form gives only one). */
export function spanText(span: ReportSpan): string {
  if (span.to.getTime() === span.from.getTime()) return formatDateTime(span.from);
  const sameDay = ukDayString(span.from) === ukDayString(span.to);
  return `${formatDateTime(span.from)}–${sameDay ? formatTime(span.to) : formatDateTime(span.to)}`;
}

/** "17 Nov, 07:00–19:00", or "17 Nov, 19:00–18 Nov, 07:00" when it ends on
 *  another day — a shift's window for people. */
export function shiftHoursText(s: { start: Date; end: Date }): string {
  const sameDay = ukDayString(s.start) === ukDayString(s.end);
  return `${formatDateTime(s.start)}–${sameDay ? formatTime(s.end) : formatDateTime(s.end)}`;
}

/** Whether a report fits a shift, and if not, which end it runs past and by
 *  how many minutes from the shift's own start or end — rounded up, so it's
 *  at least 1, and always more than the allowance it broke. */
export type ShiftFit =
  | { fits: true }
  | { fits: false; side: "before" | "after"; minutes: number };

/** How far a report may run past either end of a shift and still count as on
 *  it — a round started just before the shift, or finished just after. */
export const SHIFT_GRACE_MIN = 30;

/**
 * A report fits a shift when it starts no more than 30 minutes before the
 * shift starts and finishes no more than 30 minutes after it ends
 * (SHIFT_GRACE_MIN; pass 0 for "strictly inside"). Only then does the robot
 * put it on the shift, or keep it there in its shift check. A person linking
 * by hand may pick any shift.
 */
export function shiftFit(
  span: ReportSpan,
  s: { start: Date; end: Date },
  graceMin: number = SHIFT_GRACE_MIN,
): ShiftFit {
  const grace = graceMin * 60000;
  // Judged to the millisecond; said in whole minutes rounded up, so 30 min
  // 20 s over reads "31 min", never "30 min — more than the 30 allowed".
  const early = s.start.getTime() - span.from.getTime();
  if (early > grace) return { fits: false, side: "before", minutes: Math.ceil(early / 60000) };
  const late = span.to.getTime() - s.end.getTime();
  if (late > grace) return { fits: false, side: "after", minutes: Math.ceil(late / 60000) };
  return { fits: true };
}

/** "started 45 min before the shift" / "finished 1 h 10 min after the shift
 *  ended" — why a report doesn't fit (the minutes are rounded up, so they're
 *  always more than the allowance). */
export function outsideShiftText(fit: Exclude<ShiftFit, { fits: true }>): string {
  return fit.side === "before"
    ? `started ${apartText(fit.minutes)} before the shift`
    : `finished ${apartText(fit.minutes)} after the shift ended`;
}

/** Shifts at the site the report fits (with the allowance). */
export function shiftsOn(span: ReportSpan, shifts: ShiftCandidate[]): ShiftCandidate[] {
  return shifts.filter((s) => shiftFit(span, s).fits);
}

/** How far a report runs past a shift, in ms: before its start plus after its
 *  end (a report can run past both ends of a short shift). */
function overrunMs(span: ReportSpan, s: { start: Date; end: Date }): number {
  return (
    Math.max(0, s.start.getTime() - span.from.getTime()) +
    Math.max(0, span.to.getTime() - s.end.getTime())
  );
}

/** Minutes a report runs past a shift's start and end together: 0 when it's
 *  strictly inside, else how far, rounded up (within the allowance it still
 *  fits). */
export function shiftApartMin(span: ReportSpan, s: ShiftCandidate): number {
  return Math.ceil(overrunMs(span, s) / 60000);
}

/** Whether the rota itself has the report in that shift: from its scheduled
 *  start up to (not at) its scheduled end, so a round at 19:00 is on the shift
 *  starting at 19:00, not the one ending then. */
function onTheRota(span: ReportSpan, s: ShiftCandidate): boolean {
  if (!s.scheduled) return false;
  const start = s.scheduled.start.getTime();
  const end = s.scheduled.end.getTime();
  return span.from.getTime() >= start && span.from.getTime() < end && span.to.getTime() <= end;
}

/**
 * The static / dog-handler shift a patrol report was filed during, among those
 * it fits: the one it's strictly inside, if any; then the one worked by the
 * officer named in the form; then the one it runs least past (before and
 * after added up); then the one the rota has it in; then the one scheduled to
 * start first (`shared` = it had to choose). A shift takes any number of
 * reports (one per patrol round), and linking one changes no billing.
 */
export function pickShift(
  span: ReportSpan,
  shifts: ShiftCandidate[],
  officerId: string | null,
): { pick: ShiftCandidate; shared: boolean } | { pick: null; reason: "none" } {
  const on = shiftsOn(span, shifts);
  if (on.length === 0) return { pick: null, reason: "none" };
  const inside = on.filter((s) => shiftFit(span, s, 0).fits);
  const best = inside.length ? inside : on;
  if (best.length === 1) return { pick: best[0], shared: false };
  const theirs = officerId ? best.filter((s) => s.officerId === officerId) : [];
  if (theirs.length === 1) return { pick: theirs[0], shared: false };
  const pool = theirs.length > 1 ? theirs : best;
  const scheduledStart = (s: ShiftCandidate) => (s.scheduled?.start ?? s.start).getTime();
  const first = [...pool].sort(
    (a, b) =>
      overrunMs(span, a) - overrunMs(span, b) ||
      Number(onTheRota(span, b)) - Number(onTheRota(span, a)) ||
      scheduledStart(a) - scheduledStart(b) ||
      a.id.localeCompare(b.id),
  )[0];
  return { pick: first, shared: true };
}

/**
 * What the robot's shift check does with a report already on a shift: leave
 * it when it fits — even when another shift would now be the better pick, so
 * reports don't hop between shifts as their times are edited; when it doesn't
 * fit, move it to another shift at the site that it does fit (the same choice
 * `pickShift` makes), else take it off.
 */
export function shiftLinkAction(
  span: ReportSpan,
  current: ShiftCandidate,
  others: ShiftCandidate[],
  officerId: string | null,
):
  | { kind: "fit" }
  | { kind: "move"; to: ShiftCandidate; why: Exclude<ShiftFit, { fits: true }> }
  | { kind: "off"; why: Exclude<ShiftFit, { fits: true }> } {
  const fit = shiftFit(span, current);
  if (fit.fits) return { kind: "fit" };
  const ps = pickShift(
    span,
    others.filter((s) => s.id !== current.id),
    officerId,
  );
  return ps.pick ? { kind: "move", to: ps.pick, why: fit } : { kind: "off", why: fit };
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
  | { pick: null; reason: "none"; options: ActivityCandidate[] }
  /** The best match already has a FastField report (`taken`, its time
   *  nearest the report `at`): the report waits for a person rather than go
   *  on another activity. */
  | {
      pick: null;
      reason: "taken";
      options: ActivityCandidate[];
      taken: ActivityCandidate;
      at: Date;
      minutesApart: number;
    };

/** How far either side of the report an activity may be. */
export const MATCH_WINDOW_MIN = 180;
/** When nothing is that close: how far either side to look for the same kind
 *  of work (a report filed late, or a job logged at the wrong time). */
export const WIDE_MATCH_WINDOW_MIN = 18 * 60;
/** The default reach of `shiftsForLinking` (±24 h), used by the connector's
 *  review. The hand-link page lists ±3 days, or any day picked
 *  (fastfieldHandLink.ts). The robot never looks this far. */
export const MANUAL_LINK_WINDOW_MIN = 24 * 60;

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
 * form's own kind of work, then the nearer, then the earlier. Activities that
 * already have a FastField report are ranked the same way: when one of them
 * is the best match, the report is most likely a second report for it, so it
 * waits for a person ("taken") rather than go on the next activity along —
 * perhaps another kind of work, which it would mark done and bill. A free
 * activity still wins when it's the better match.
 */
export function pickActivity(
  when: Date,
  formJobType: string,
  candidates: ActivityCandidate[],
  windowMin: number = MATCH_WINDOW_MIN,
): ActivityPick {
  const near = candidates
    .map((c) => ({ c, m: minutesApart(c, when) }))
    .filter((x) => x.m <= windowMin)
    .map((x) => ({ ...x, score: x.m - (x.c.type === formJobType ? SAME_TYPE_BONUS_MIN : 0) }))
    .sort((a, b) => a.score - b.score);

  if (near.length === 0) return { pick: null, reason: "none", options: [] };
  const close = near.filter((x) => x.score - near[0].score < CLEAR_MARGIN_MIN);
  close.sort(
    (a, b) =>
      Number(b.c.type === formJobType) - Number(a.c.type === formJobType) ||
      a.m - b.m ||
      firstTime(a.c) - firstTime(b.c) ||
      a.c.id.localeCompare(b.c.id),
  );
  const best = close[0];
  if (best.c.taken) {
    return {
      pick: null,
      reason: "taken",
      options: near.map((x) => x.c),
      taken: best.c,
      at: nearestTime(best.c, when),
      minutesApart: Math.round(best.m),
    };
  }
  return {
    pick: best.c,
    minutesApart: Math.round(best.m),
    closeCall: close.length > 1,
  };
}

function firstTime(c: ActivityCandidate): number {
  return Math.min(...c.times.map((t) => t.getTime()));
}

/** The one of an activity's times nearest the report's. */
function nearestTime(c: ActivityCandidate, when: Date): Date {
  return c.times.reduce((best, t) =>
    Math.abs(t.getTime() - when.getTime()) < Math.abs(best.getTime() - when.getTime()) ? t : best,
  );
}

/**
 * The fallback when nothing at the site is within 3 hours: the nearest
 * activity of the same kind of work (patrol or VPI, callout, lock-up, unlock)
 * within 18 hours either side, of those already due by `now` — so a report
 * never completes tonight's patrol early. As within 3 hours, when the best of
 * them already has a FastField report the report waits ("taken") rather than
 * go on another one.
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
      c.times.some((t) => t.getTime() <= now.getTime()),
  );
  return pickActivity(when, formJobType, fits, WIDE_MATCH_WINDOW_MIN);
}
