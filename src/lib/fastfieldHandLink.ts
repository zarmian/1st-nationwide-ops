/**
 * Linking a FastField report by hand (Admin → FastField → a report): the pure
 * parts — which stretch of time the list covers, what to say about each
 * activity, how the site picker is grouped, and the confirmation and toast
 * texts. The database side is `activitiesNearReport` / `shiftsForLinking` in
 * lib/fastfieldImport.ts.
 *
 * The owner's rule: a person can link any report to any shift, job or visit.
 * Nothing here hides an activity; it only says what the robot would have made
 * of it and what linking it does.
 */
import { parseIsoDate, ukDayString } from "@/lib/dates";
import { apartText, type ReportSpan } from "@/lib/fastfield";

/** The list covers this many days either side of the report's own time (the
 *  robot never looks further than 18 hours). */
export const HAND_LINK_REACH_DAYS = 3;

export type HandLinkWindow = {
  from: Date;
  to: Date;
  /** The UK day ("YYYY-MM-DD") picked instead of the report's time. */
  day: string | null;
};

/**
 * One UK calendar day when `day` is a valid "YYYY-MM-DD", otherwise
 * HAND_LINK_REACH_DAYS either side of the report's own time.
 */
export function handLinkWindow(span: ReportSpan, day?: string | null): HandLinkWindow {
  const start = day ? parseIsoDate(day) : null;
  const end = day ? parseIsoDate(day, true) : null;
  // parseIsoDate rolls "2026-02-31" over into March: only take a real day.
  if (day && start && end && ukDayString(start) === day) return { from: start, to: end, day };
  const reach = HAND_LINK_REACH_DAYS * 86_400_000;
  return {
    from: new Date(span.from.getTime() - reach),
    to: new Date(span.to.getTime() + reach),
    day: null,
  };
}

/** "45 min", "5 h 10 min", "3 days" — a gap for the hand-link list. */
export function gapText(minutes: number): string {
  if (minutes >= 2 * 1440) return `${Math.round(minutes / 1440)} days`;
  return apartText(minutes);
}

/** "45 min after the report" / "during the report". */
export function besideReportText(a: { minutes: number; side: "before" | "during" | "after" }): string {
  return a.side === "during" || a.minutes === 0
    ? "during the report"
    : `${gapText(a.minutes)} ${a.side} the report`;
}

const JOB_WORDS: Record<string, [string, string]> = {
  ALARM_RESPONSE: ["Callout", "callout"],
  PATROL: ["Patrol job", "patrol job"],
  LOCK: ["Lock-up", "lock-up"],
  UNLOCK: ["Unlock", "unlock"],
  KEY_COLLECTION: ["Key collection", "key collection"],
  KEY_DROPOFF: ["Key drop-off", "key drop-off"],
  SURVEY: ["Survey", "survey"],
  VPI: ["VPI", "VPI"],
  ADHOC: ["Ad-hoc job", "ad-hoc job"],
  STATIC_GUARDING_SHIFT: ["Static-guarding shift job", "static-guarding shift job"],
  DOG_HANDLER_SHIFT: ["Dog-handler shift job", "dog-handler shift job"],
};

/**
 * What to call an activity: a label ("Static shift", "Callout", "VPI visit")
 * and the noun for sentences ("static shift", "callout", "VPI visit").
 * `type` is the JobType for a job, "PATROL" or "VPI" (its schedule's kind)
 * for a visit, and the ShiftType for a shift.
 */
export function activityWords(kind: "job" | "visit" | "shift", type: string): { label: string; noun: string } {
  if (kind === "shift") {
    return type === "DOG_HANDLER"
      ? { label: "Dog-handler shift", noun: "dog-handler shift" }
      : { label: "Static shift", noun: "static shift" };
  }
  if (kind === "visit") {
    return type === "VPI"
      ? { label: "VPI visit", noun: "VPI visit" }
      : { label: "Patrol visit", noun: "patrol visit" };
  }
  const w = JOB_WORDS[type];
  return w ? { label: w[0], noun: w[1] } : { label: "Job", noun: "job" };
}

/** The facts about an activity that decide its markers. */
export type HandLinkFacts = {
  kind: "job" | "visit" | "shift";
  /** JobType / "PATROL" | "VPI" / ShiftType, as for activityWords. */
  type: string;
  status: string;
  /** Handled by a partner (subcontracted, or the partner's own). */
  partner: boolean;
  /** Jobs: the job a patrol visit stands on (the robot links the visit). */
  forVisit?: boolean;
  /** Jobs and visits: already has a report (FastField or the officer's own). */
  taken?: boolean;
};

const SHIFT_JOB_TYPES = new Set(["STATIC_GUARDING_SHIFT", "DOG_HANDLER_SHIFT"]);

/**
 * Short notes on why the robot would skip an activity, shown next to it
 * instead of hiding it: "cancelled — linking won't reopen it", "a partner's
 * job", "already has a report", … Empty when the robot could pick it too.
 */
export function handLinkMarkers(a: HandLinkFacts): string[] {
  const out: string[] = [];
  if (a.kind === "shift") {
    if (a.partner) out.push("a partner's shift");
    if (a.status === "MISSED") out.push("marked missed");
    if (a.status === "ABANDONED") out.push("marked abandoned");
    return out;
  }
  if (a.status === "CANCELLED") out.push("cancelled — linking won't reopen it");
  if (a.partner) out.push(a.kind === "job" ? "a partner's job" : "a partner's visit");
  if (a.kind === "job" && a.forVisit) out.push("the job of a patrol visit");
  if (a.kind === "job" && SHIFT_JOB_TYPES.has(a.type)) out.push("stands for a shift");
  if (a.taken) out.push("already has a report");
  return out;
}

/**
 * What linking does to the activity, for the confirmation (`effect`) and the
 * toast afterwards (`toast`). A shift is never changed; a job or visit that
 * isn't done yet is marked done and may be billed and paid; a cancelled one,
 * or a job that stands for a shift, keeps its status and money (the report is
 * only attached).
 */
export function linkOutcome(a: {
  kind: "job" | "visit" | "shift";
  noun: string;
  cancelled: boolean;
  /** Linking marks it done (a job or visit not finished yet). */
  marksDone: boolean;
  /** A job that stands for a shift (billed through the shift). */
  standsForShift?: boolean;
}): { effect: string; toast: string } {
  if (a.kind === "shift") {
    return {
      effect:
        "The report goes on the shift as a patrol round. Nothing on the shift changes and nothing is billed, and the robot leaves a report you link by hand where you put it.",
      toast: "Report linked to the shift. Nothing on the shift was changed.",
    };
  }
  if (a.standsForShift) {
    return {
      effect: `This ${a.noun} stands for a shift, which is billed itself. The report is attached, but the ${a.noun} is left as it is: not marked done, billed or paid.`,
      toast: `Report linked. The ${a.noun} was left as it is.`,
    };
  }
  if (a.cancelled) {
    return {
      effect: `This ${a.noun} was cancelled. The report is attached, but the ${a.noun} stays cancelled: its status, times and money are left as they are.`,
      toast: `Report linked. The ${a.noun} stays cancelled.`,
    };
  }
  if (a.marksDone) {
    return {
      effect: `The ${a.noun} is marked done with the report's times, and is billed and paid if it hasn't been yet.`,
      toast: `Report linked — the ${a.noun} is marked done and may be billed and paid.`,
    };
  }
  return {
    effect: `The ${a.noun} is already done, so its status stays. Any empty times are filled in from the report, and it's billed and paid if it hasn't been yet.`,
    toast: `Report linked to the ${a.noun}.`,
  };
}

/** Whose a site is: its client, else the partner it's for. */
export type SiteOwner = { key: string; name: string };

export function siteOwner(site: {
  customer?: { id: string; name: string } | null;
  partner?: { id: string; name: string } | null;
}): SiteOwner | null {
  if (site.customer) return { key: `c:${site.customer.id}`, name: site.customer.name };
  if (site.partner) return { key: `p:${site.partner.id}`, name: site.partner.name };
  return null;
}

/**
 * A warning when the activity belongs to a different client than the report
 * seems to: the client the form is for, or the client of the site the report
 * was matched to. Their portal would show the report. Null when they agree,
 * or when either side isn't known.
 */
export function otherClientWarning(a: {
  /** "static shift", "callout", "site", … */
  what: string;
  owner: SiteOwner | null;
  formClient: { id: string; name: string } | null;
  matchedSite: { name: string; owner: SiteOwner | null } | null;
}): string | null {
  if (!a.owner) return null;
  const why: string[] = [];
  if (a.formClient && `c:${a.formClient.id}` !== a.owner.key) {
    why.push(`The form is for ${a.formClient.name}.`);
  }
  if (a.matchedSite?.owner && a.matchedSite.owner.key !== a.owner.key) {
    why.push(`The report was matched to ${a.matchedSite.name} (${a.matchedSite.owner.name}).`);
  }
  if (why.length === 0) return null;
  return `This is a different client's ${a.what} (${a.owner.name}): their portal will show this report. ${why.join(" ")}`;
}

export type LinkSite = {
  id: string;
  name: string;
  active: boolean;
  customer: { id: string; name: string } | null;
  partner: { id: string; name: string } | null;
};

/**
 * The site picker's groups, one per client: the clients in `first` (the
 * form's client, then the matched site's) at the top in that order, then the
 * rest A–Z, then sites with no client. Sites keep the order they come in.
 */
export function groupSitesForLinking<T extends LinkSite>(
  sites: T[],
  first: (string | null | undefined)[],
): { key: string; label: string; sites: T[] }[] {
  const groups = new Map<string, { key: string; label: string; sites: T[] }>();
  for (const s of sites) {
    const owner = siteOwner(s);
    const key = owner?.key ?? "none";
    const label = !owner ? "No client" : s.customer ? owner.name : `${owner.name} (partner)`;
    const g = groups.get(key) ?? { key, label, sites: [] };
    g.sites.push(s);
    groups.set(key, g);
  }
  const top = first.filter((k, i): k is string => !!k && first.indexOf(k) === i);
  const rank = (key: string) => {
    const i = top.indexOf(key);
    return i >= 0 ? i : key === "none" ? top.length + 1 : top.length;
  };
  return Array.from(groups.values()).sort(
    (a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "en-GB"),
  );
}
