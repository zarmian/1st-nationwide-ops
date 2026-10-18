/**
 * Daily check — the pure rules (no database, no network), so they're tested
 * on their own. lib/dailyCheck.ts loads the data and calls these.
 *
 *   findDuplicatePairs — the same visit recorded twice at a site: a patrol
 *     from our schedule and the Nexus activity for it, a callout logged by
 *     the office and one made from a FastField report, …
 *   reportIssues — a FastField report whose GPS, typed site name, form or
 *     officer doesn't fit what it was attached to.
 *   keywordIncidents — incidents spotted by keyword, for when Claude isn't
 *     available to read the reports.
 */
import { haversineMeters } from "@/lib/geo";
import { normaliseNameKey } from "@/lib/siteDuplicates";
import {
  answerKind,
  answerText,
  extractPostcode,
  normalisePostcode,
  type FastFieldAnswer,
} from "@/lib/fastfield";

// ── Duplicates ────────────────────────────────────────────────────────────

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

export type CheckActivity = {
  kind: "job" | "visit";
  id: string;
  siteId: string;
  /** JobType, or the schedule kind (PATROL / VPI) for a visit. */
  type: string;
  /** Where the record came from: "Our schedule", "Nexus", "Keyholding", … */
  source: string;
  /** The best single time: when it was done if known, else scheduled. */
  main: Date;
  /** Every time the record carries (scheduled, started, done). */
  times: Date[];
  status: string;
  /** A job that stands for a patrol visit (Job.patrolVisitId). */
  visitId?: string | null;
  /** Shared by site records that are one place (see samePlaceIds); records
   *  are compared by this, else by siteId. */
  placeId?: string;
};

/**
 * Site records that are the same place: the same postcode, and one name
 * contains the other ("Swail House" and "Swail House, Ashley Road, Epsom") —
 * the usual sign of a site set up by hand and again by a partner import.
 * Different businesses sharing a postcode (a business park) keep their own.
 * Returns siteId → place id (the first site's id of each group).
 */
export function samePlaceIds(
  sites: { id: string; name: string; postcode: string | null }[],
): Map<string, string> {
  const place = new Map<string, string>();
  const byPostcode = new Map<string, { id: string; key: string }[]>();
  for (const s of sites) {
    place.set(s.id, s.id);
    const pc = (s.postcode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const key = normaliseNameKey(s.name);
    if (!pc || !key) continue;
    byPostcode.set(pc, [...(byPostcode.get(pc) ?? []), { id: s.id, key }]);
  }
  for (const list of Array.from(byPostcode.values())) {
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = list[i];
        const b = list[j];
        if (a.key.includes(b.key) || b.key.includes(a.key)) {
          const root = place.get(b.id)!;
          for (const [id, p] of Array.from(place.entries())) {
            if (p === place.get(a.id)) place.set(id, root);
          }
        }
      }
    }
  }
  return place;
}

/** Padding around an activity's times when judging overlap. */
const PAD_MS = 30 * 60_000;
/** Two records from the same source count only when they're the same type
 *  of work this close together (our own patrol + VPI at one time is two
 *  services, not a duplicate). */
const SAME_SOURCE_MS = 30 * 60_000;

export function windowOf(a: CheckActivity): { start: number; end: number } {
  const ts = (a.times.length ? a.times : [a.main]).map((d) => d.getTime());
  return { start: Math.min(...ts) - PAD_MS, end: Math.max(...ts) + PAD_MS };
}

function linked(a: CheckActivity, b: CheckActivity): boolean {
  return (
    (a.kind === "job" && b.kind === "visit" && a.visitId === b.id) ||
    (b.kind === "job" && a.kind === "visit" && b.visitId === a.id)
  );
}

/**
 * Pairs of records at the same site (or the same place on two site records),
 * of the same kind of work, whose times overlap — from different sources (our schedule vs Nexus, the office vs a
 * FastField report, …), or of the same type from the same source within half
 * an hour. Each
 * record is paired at most once, closest first, so a site with two patrols a
 * night pairs each patrol with its own counterpart.
 */
export function findDuplicatePairs(acts: CheckActivity[]): [CheckActivity, CheckActivity][] {
  const groups = new Map<string, CheckActivity[]>();
  for (const a of acts) {
    const fam = familyOf(a.type);
    if (!fam) continue;
    const key = `${a.placeId ?? a.siteId}|${fam}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const pairs: [CheckActivity, CheckActivity][] = [];
  for (const list of Array.from(groups.values())) {
    if (list.length < 2) continue;
    const candidates: { a: CheckActivity; b: CheckActivity; gap: number }[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (linked(a, b)) continue;
        const wa = windowOf(a);
        const wb = windowOf(b);
        if (wa.end < wb.start || wb.end < wa.start) continue;
        const gap = Math.abs(a.main.getTime() - b.main.getTime());
        if (a.source === b.source && (a.type !== b.type || gap > SAME_SOURCE_MS)) continue;
        candidates.push({ a, b, gap });
      }
    }
    candidates.sort((x, y) => x.gap - y.gap);
    const used = new Set<string>();
    for (const c of candidates) {
      if (used.has(c.a.id) || used.has(c.b.id)) continue;
      used.add(c.a.id);
      used.add(c.b.id);
      pairs.push(c.a.main <= c.b.main ? [c.a, c.b] : [c.b, c.a]);
    }
  }
  return pairs;
}

// ── FastField report checks ───────────────────────────────────────────────

/** Beyond this (or the site's own geofence, if larger) the GPS is flagged. */
export const GPS_FLAG_M = 500;

const CALLOUT_FAMILY = new Set(["ALARM_RESPONSE", "ADHOC", "KEY_COLLECTION", "KEY_DROPOFF", "SURVEY"]);

const KIND_WORD: Record<string, string> = {
  ALARM_RESPONSE: "a callout",
  ADHOC: "an ad-hoc job",
  KEY_COLLECTION: "a key collection",
  KEY_DROPOFF: "a key drop-off",
  SURVEY: "a survey",
  PATROL: "a patrol",
  VPI: "a VPI",
  LOCK: "a lock-up",
  UNLOCK: "an unlock",
  SHIFT: "a static shift",
};
const kindWord = (k: string) => KIND_WORD[k] ?? "a job";

export type ReportCheckInput = {
  siteText: string | null;
  lat: number | null;
  lng: number | null;
  site: {
    id: string;
    name: string;
    postcode: string | null;
    lat: number | null;
    lng: number | null;
    geofenceRadiusM: number | null;
  } | null;
  /** The sites the typed name fits on its own (the site matcher's answer);
   *  null when the form gives no site name. */
  nameFits: { ids: string[]; firstName: string | null } | null;
  /** What the report says it is: the form's answer, else the form's setting. */
  reportKind: string;
  /** What it's attached to: a JobType, "PATROL" for a visit, "SHIFT", or null. */
  linkedKind: string | null;
  officerText: string | null;
  officerKnown: boolean;
};

/** Plain-English problems with one FastField report; empty when it fits. */
export function reportIssues(r: ReportCheckInput): string[] {
  const issues: string[] = [];
  const site = r.site;

  if (site && r.lat != null && r.lng != null && site.lat != null && site.lng != null) {
    const d = haversineMeters(r.lat, r.lng, site.lat, site.lng);
    const limit = Math.max(GPS_FLAG_M, site.geofenceRadiusM ?? 0);
    if (d > limit) {
      issues.push(
        `The phone was ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`} from ${site.name} when the form was filled in.`,
      );
    }
  }

  if (site && r.siteText) {
    const pc = extractPostcode(r.siteText);
    const postcodeFits = pc != null && pc === normalisePostcode(site.postcode);
    const nameFits = !r.nameFits || r.nameFits.ids.includes(site.id);
    if (pc != null && !postcodeFits) {
      issues.push(`The form gives postcode ${pc}, but ${site.name} is ${site.postcode ?? "unknown"}.`);
    } else if (!postcodeFits && !nameFits) {
      const other =
        r.nameFits && r.nameFits.ids.length === 1 && r.nameFits.firstName
          ? ` (which reads like ${r.nameFits.firstName})`
          : "";
      issues.push(`The form names the site “${r.siteText}”${other}, but it was attached to ${site.name}.`);
    }
  }

  if (r.linkedKind) {
    const reportCallout = CALLOUT_FAMILY.has(r.reportKind);
    const linkedCallout = CALLOUT_FAMILY.has(r.linkedKind);
    const reportPatrol = r.reportKind === "PATROL" || r.reportKind === "VPI";
    const linkedPatrol = r.linkedKind === "PATROL" || r.linkedKind === "VPI" || r.linkedKind === "SHIFT";
    const lockClash =
      (r.reportKind === "LOCK" || r.reportKind === "UNLOCK") &&
      (r.linkedKind === "LOCK" || r.linkedKind === "UNLOCK") &&
      r.reportKind !== r.linkedKind;
    if ((reportPatrol && linkedCallout) || (reportCallout && linkedPatrol) || lockClash) {
      issues.push(
        `The form is for ${kindWord(r.reportKind)}, but it was attached to ${kindWord(r.linkedKind)}.`,
      );
    }
  }

  if (r.officerText && !r.officerKnown) {
    issues.push(`The officer “${r.officerText}” isn't on the staff list, so pay can't be matched.`);
  }
  return issues;
}

// ── Incidents (keyword fallback) ──────────────────────────────────────────

const INCIDENT_WORDS: { re: RegExp; category: string }[] = [
  { re: /break[\s-]?in|broken into|forced entry|forced open|burglar/i, category: "Break-in" },
  { re: /intruder|trespass|suspicious (?:person|people|male|female|vehicle|activity)|rough sleeper/i, category: "Intruder / suspicious" },
  { re: /damage|smashed|broken (?:window|glass|lock|door|gate)|vandal|graffiti/i, category: "Damage" },
  { re: /police|fire brigade|fire service|ambulance|999/i, category: "Emergency services" },
  { re: /\bfire\b|smoke|flood|water leak|leaking/i, category: "Fire / water" },
  { re: /left open|found open|insecure|unlocked|not secure|unsecured/i, category: "Insecure site" },
  { re: /stolen|theft|missing items/i, category: "Theft" },
  { re: /injur|hurt|accident/i, category: "Injury" },
  { re: /locked in|trapped|stuck on site/i, category: "Person locked in" },
  { re: /alarm (?:fault|faulty|kept going|won't set|would not set)|fault on the/i, category: "Alarm fault" },
];

/** Routine "nothing to report" phrasing — not an incident even with a word above. */
const ALL_CLEAR = /^(?:all (?:secure|fine|ok|good|clear)|no (?:issues?|problems?|incidents?)|nothing to report|n\/?a|none)\.?$/i;
const NEGATED = /\bno (?:sign of|signs of|evidence of)\b|\bnot? (?:any )?(?:damage|intruders?)\b/i;

/** Incidents found by keyword in a report's written answers (and Yes answers
 *  to incident questions). Used when Claude can't read the reports. */
export function keywordIncidents(answers: FastFieldAnswer[]): { category: string; summary: string }[] {
  const out: { category: string; summary: string }[] = [];
  const seen = new Set<string>();
  for (const a of answers) {
    const kind = answerKind(a.type);
    if (kind === "tri") {
      const n = typeof a.value === "string" ? Number(a.value) : a.value;
      const hit = INCIDENT_WORDS.find((w) => w.re.test(a.label));
      if (n === 1 && hit && !seen.has(hit.category)) {
        seen.add(hit.category);
        out.push({ category: hit.category, summary: `Answered Yes to “${a.label}”.` });
      }
      continue;
    }
    if (kind !== "text") continue;
    const text = answerText(a.value);
    if (!text || ALL_CLEAR.test(text) || NEGATED.test(text)) continue;
    for (const w of INCIDENT_WORDS) {
      if (w.re.test(text) && !seen.has(w.category)) {
        seen.add(w.category);
        out.push({ category: w.category, summary: text.slice(0, 160) });
      }
    }
  }
  return out;
}

/** The written parts of a report for Claude to read: question → answer,
 *  photos and signatures left out, long answers trimmed. */
export function reportText(answers: FastFieldAnswer[], maxChars = 1500): string {
  const lines: string[] = [];
  for (const a of answers) {
    const kind = answerKind(a.type);
    if (kind === "photo" || kind === "signature" || kind === "location" || kind === "date") continue;
    let v: string | null;
    if (kind === "tri") {
      const n = typeof a.value === "string" ? Number(a.value) : a.value;
      v = n === 1 ? "Yes" : n === 0 ? "No" : n === 2 ? "N/A" : null;
    } else {
      v = answerText(a.value);
    }
    if (!v) continue;
    lines.push(`${a.label.slice(0, 120)}: ${v.slice(0, 400)}`);
  }
  return lines.join("\n").slice(0, maxChars);
}
