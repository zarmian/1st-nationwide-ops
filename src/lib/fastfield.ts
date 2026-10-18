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

  return {
    siteText: siteAnswer ? textOf(siteAnswer) : null,
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
  };
}

// ── Site ──────────────────────────────────────────────────────────────────

export type SiteRow = SiteCandidate & { lat: number | null; lng: number | null };

export type SitePick =
  | { site: SiteRow; how: "name" | "name+gps" | "gps"; distanceM: number | null }
  | { site: null; reason: string };

/** Within this distance a GPS fix alone identifies the site. */
export const GPS_ONLY_MAX_M = 500;
/** Within this distance GPS settles a name that fits several sites. */
export const GPS_TIEBREAK_MAX_M = 2000;

function distanceTo(site: SiteRow, lat: number | null, lng: number | null): number | null {
  if (lat == null || lng == null || site.lat == null || site.lng == null) return null;
  return haversineMeters(lat, lng, site.lat, site.lng);
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

/**
 * Which site a report is for: the site named in the form (fuzzy, like the
 * Telegram bot), with the phone's GPS settling a name that fits several
 * sites, or standing in when the name isn't recognised.
 */
export function pickSite(
  siteText: string | null,
  lat: number | null,
  lng: number | null,
  sites: SiteRow[],
): SitePick {
  if (siteText) {
    const m = matchSite(siteText, sites);
    if (m.kind === "one") {
      const site = m.site as SiteRow;
      return { site, how: "name", distanceM: distanceTo(site, lat, lng) };
    }
    if (m.kind === "many") {
      const near = nearest(m.sites as SiteRow[], lat, lng, GPS_TIEBREAK_MAX_M);
      if (near) return { site: near.site, how: "name+gps", distanceM: near.distanceM };
      return {
        site: null,
        reason: `“${siteText}” fits ${m.sites.length} sites — pick the right one.`,
      };
    }
  }
  const near = nearest(sites, lat, lng, GPS_ONLY_MAX_M);
  if (near) return { site: near.site, how: "gps", distanceM: near.distanceM };
  if (siteText) return { site: null, reason: `Site “${siteText}” not recognised.` };
  return { site: null, reason: "The form doesn't say which site, and has no GPS fix near one." };
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
  | { pick: ActivityCandidate; minutesApart: number }
  | { pick: null; reason: "none" | "taken" | "ambiguous"; options: ActivityCandidate[] };

/** How far either side of the report an activity may be. */
export const MATCH_WINDOW_MIN = 180;
/** An activity of the form's own type counts as this much closer. */
const SAME_TYPE_BONUS_MIN = 30;
/** The runner-up must be at least this much further away for a clear pick. */
const CLEAR_MARGIN_MIN = 20;

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
 * 3 hours either side, preferring the form's own type when two are close.
 * Leaves it for a person when two activities are about equally close, or the
 * only ones nearby already have a FastField report.
 */
export function pickActivity(
  when: Date,
  formJobType: string,
  candidates: ActivityCandidate[],
): ActivityPick {
  const near = candidates
    .map((c) => ({ c, m: minutesApart(c, when) }))
    .filter((x) => x.m <= MATCH_WINDOW_MIN);
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
  if (free.length > 1 && free[1].score - free[0].score < CLEAR_MARGIN_MIN) {
    return { pick: null, reason: "ambiguous", options: free.map((x) => x.c) };
  }
  return { pick: free[0].c, minutesApart: Math.round(free[0].m) };
}
