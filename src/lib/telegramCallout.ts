/**
 * Turn a dispatcher's free-text Telegram message into a ready-to-create
 * callout — in two stages:
 *
 *   1. parseCalloutText()  — asks the model to extract structured fields
 *                            (site text, type, who to assign, when, notes).
 *   2. resolveCallout()    — PURE: matches the extracted site/officer/partner
 *                            text against the real roster, fills defaults,
 *                            and returns either a ready BotCalloutData +
 *                            confirmation summary, or a list of problems to
 *                            send back ("couldn't find that site", etc.).
 *
 * Keeping resolution pure (candidates passed in, no DB/network) means the
 * matching + summary logic is unit-tested without a database or API key.
 */
import { formatDateTime, parseUkDateTimeLocal } from "@/lib/dates";
import { extractWithTools, type JsonSchema, type ToolDef } from "@/lib/anthropic";
import {
  BOT_CALLOUT_SOURCES,
  BOT_CALLOUT_TYPES,
  type BotCalloutData,
  type BotCalloutSource,
  type BotCalloutType,
} from "@/lib/calloutTypes";

// ── Types ────────────────────────────────────────────────────────────────

export type ParsedCallout = {
  siteQuery?: string | null;
  type?: string | null;
  typeLabel?: string | null;
  source?: string | null;
  priority?: string | null;
  handlerKind?: string | null;
  officerName?: string | null;
  partnerName?: string | null;
  partnerOfficerName?: string | null;
  scheduledFor?: string | null;
  notes?: string | null;
};

export type PersonCandidate = { id: string; name: string };
export type SiteCandidate = {
  id: string;
  name: string;
  code: string | null;
  postcode: string | null;
};

export type ResolveContext = {
  sites: SiteCandidate[];
  officers: PersonCandidate[];
  partners: PersonCandidate[];
};

export type ResolveResult = {
  ok: boolean;
  data?: BotCalloutData;
  summary: string;
  problems: string[];
};

// ── Pretty labels for the confirmation card ────────────────────────────────

const TYPE_LABELS: Record<BotCalloutType, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
};

const SOURCE_LABELS: Record<BotCalloutSource, string> = {
  ALARM: "Alarm",
  PARTNER_REQUEST: "Partner request",
  CUSTOMER_REQUEST: "Customer request",
  AD_HOC: "Ad-hoc",
};

// ── Text matching ──────────────────────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type SiteMatch =
  | { kind: "one"; site: SiteCandidate }
  | { kind: "none" }
  | { kind: "many"; sites: SiteCandidate[] };

/**
 * Match a free-text site reference against the site list. Tiered: exact
 * code, then exact name, then substring either direction, then postcode.
 * Returns "many" (with candidates) when a short query hits several sites so
 * the caller can ask the dispatcher to be specific.
 */
export function matchSite(query: string, sites: SiteCandidate[]): SiteMatch {
  const q = norm(query);
  if (!q) return { kind: "none" };

  const exactCode = sites.filter((s) => s.code && norm(s.code) === q);
  if (exactCode.length === 1) return { kind: "one", site: exactCode[0] };

  const exactName = sites.filter((s) => norm(s.name) === q);
  if (exactName.length === 1) return { kind: "one", site: exactName[0] };
  if (exactName.length > 1) return { kind: "many", sites: exactName };

  const substr = sites.filter((s) => {
    const n = norm(s.name);
    return n.includes(q) || q.includes(n);
  });
  if (substr.length === 1) return { kind: "one", site: substr[0] };
  if (substr.length > 1) return { kind: "many", sites: substr };

  const qNoSpace = q.replace(/ /g, "");
  const byPostcode = sites.filter(
    (s) => s.postcode && norm(s.postcode).replace(/ /g, "").includes(qNoSpace),
  );
  if (byPostcode.length === 1) return { kind: "one", site: byPostcode[0] };
  if (byPostcode.length > 1) return { kind: "many", sites: byPostcode };

  return { kind: "none" };
}

type PersonMatch =
  | { kind: "one"; person: PersonCandidate }
  | { kind: "none" }
  | { kind: "many"; people: PersonCandidate[] };

/** Match a person name (officer or partner) — substring either direction. */
export function matchPerson(
  query: string,
  people: PersonCandidate[],
): PersonMatch {
  const q = norm(query);
  if (!q) return { kind: "none" };

  const exact = people.filter((p) => norm(p.name) === q);
  if (exact.length === 1) return { kind: "one", person: exact[0] };

  const substr = people.filter((p) => {
    const n = norm(p.name);
    return n.includes(q) || q.includes(n);
  });
  if (substr.length === 1) return { kind: "one", person: substr[0] };
  if (substr.length > 1) return { kind: "many", people: substr };

  return { kind: "none" };
}

function listNames(items: { name: string }[], max = 6): string {
  const names = items.slice(0, max).map((i) => i.name);
  const extra = items.length - names.length;
  return names.join(", ") + (extra > 0 ? `, and ${extra} more` : "");
}

// ── Resolution (pure) ──────────────────────────────────────────────────────

/**
 * Resolve parsed fields against the roster. `now` is injected for
 * testability. Always returns a `summary` (for the confirmation card);
 * `data` is present only when there are no problems.
 */
export function resolveCallout(
  parsed: ParsedCallout,
  ctx: ResolveContext,
  now: Date = new Date(),
): ResolveResult {
  const problems: string[] = [];

  // Type + source (the tool schema constrains these; coerce defensively).
  const type: BotCalloutType = (BOT_CALLOUT_TYPES as readonly string[]).includes(
    parsed.type ?? "",
  )
    ? (parsed.type as BotCalloutType)
    : "ADHOC";

  let source: BotCalloutSource = (BOT_CALLOUT_SOURCES as readonly string[]).includes(
    parsed.source ?? "",
  )
    ? (parsed.source as BotCalloutSource)
    : type === "ALARM_RESPONSE"
      ? "ALARM"
      : "CUSTOMER_REQUEST";

  const priority: "LOW" | "MEDIUM" | "HIGH" =
    parsed.priority === "LOW" || parsed.priority === "HIGH"
      ? parsed.priority
      : "MEDIUM";

  const handlerKind: "officer" | "partner" =
    parsed.handlerKind === "partner" ? "partner" : "officer";

  // Site.
  let siteName = "—";
  let siteId: string | null = null;
  const siteQuery = (parsed.siteQuery ?? "").trim();
  if (!siteQuery) {
    problems.push("Which site? I couldn't spot a site in that message.");
  } else {
    const m = matchSite(siteQuery, ctx.sites);
    if (m.kind === "one") {
      siteId = m.site.id;
      siteName = m.site.name;
    } else if (m.kind === "none") {
      problems.push(`I couldn't find a site matching “${siteQuery}”.`);
    } else {
      problems.push(
        `“${siteQuery}” matches several sites (${listNames(m.sites)}). Which one?`,
      );
    }
  }

  // Handler.
  let assignedToUserId: string | null = null;
  let handlerPartnerId: string | null = null;
  let handlerLabel = "Unassigned";

  if (handlerKind === "officer") {
    const who = (parsed.officerName ?? "").trim();
    if (!who) {
      problems.push(
        "Who should attend? Name an officer, or say which partner to give it to.",
      );
    } else {
      const m = matchPerson(who, ctx.officers);
      if (m.kind === "one") {
        assignedToUserId = m.person.id;
        handlerLabel = m.person.name;
      } else if (m.kind === "none") {
        problems.push(`I couldn't find an officer matching “${who}”.`);
      } else {
        problems.push(
          `“${who}” matches several officers (${listNames(m.people)}). Which one?`,
        );
      }
    }
  } else {
    const who = (parsed.partnerName ?? "").trim();
    if (!who) {
      problems.push("Which partner should take it?");
    } else {
      const m = matchPerson(who, ctx.partners);
      if (m.kind === "one") {
        handlerPartnerId = m.person.id;
        handlerLabel = m.person.name;
      } else if (m.kind === "none") {
        problems.push(`I couldn't find a partner matching “${who}”.`);
      } else {
        problems.push(
          `“${who}” matches several partners (${listNames(m.people)}). Which one?`,
        );
      }
    }
  }

  // When (optional). A bad date is a problem; absent = attend now.
  let scheduledFor: Date | null = null;
  let whenLabel = "Now";
  if (parsed.scheduledFor) {
    const dt = parseUkDateTimeLocal(parsed.scheduledFor);
    if (!dt || Number.isNaN(dt.getTime())) {
      problems.push(`I couldn't read the time “${parsed.scheduledFor}”.`);
    } else {
      scheduledFor = dt;
      whenLabel = formatDateTime(dt);
    }
  }

  const typeLabel = parsed.typeLabel?.trim() || null;
  const notes = parsed.notes?.trim() || null;
  const partnerOfficerName = parsed.partnerOfficerName?.trim() || null;

  // Build the confirmation summary regardless of problems.
  const typeText = typeLabel ? `${TYPE_LABELS[type]} — ${typeLabel}` : TYPE_LABELS[type];
  const handlerLine =
    handlerKind === "partner"
      ? `Hand to partner: ${handlerLabel}${partnerOfficerName ? ` (${partnerOfficerName})` : ""}`
      : `Assign to: ${handlerLabel}`;
  const summaryLines = [
    `Site: ${siteName}`,
    `Type: ${typeText}`,
    `Source: ${SOURCE_LABELS[source]}`,
    handlerLine,
    `When: ${whenLabel}`,
  ];
  if (notes) summaryLines.push(`Notes: ${notes}`);
  const summary = summaryLines.join("\n");

  if (problems.length > 0 || !siteId) {
    return { ok: false, summary, problems };
  }

  const data: BotCalloutData = {
    siteId,
    type,
    typeLabel,
    source,
    priority,
    handlerKind,
    assignedToUserId,
    handlerPartnerId,
    partnerOfficerName,
    scheduledFor,
    notes,
  };
  return { ok: true, data, summary, problems: [] };
}

// ── Model call ─────────────────────────────────────────────────────────────

const CALLOUT_TOOL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    siteQuery: {
      type: "string",
      description:
        "The site name, code, or area exactly as referenced (e.g. 'Neasden', 'Shurgard Norbury', 'NW10'). Copy the location text — never invent one.",
    },
    type: {
      type: "string",
      enum: [...BOT_CALLOUT_TYPES],
      description:
        "ALARM_RESPONSE for an alarm activation; LOCK/UNLOCK for a lock-up or unlock; PATROL for a patrol; VPI for a vacant-property inspection; ADHOC otherwise.",
    },
    typeLabel: {
      type: "string",
      description:
        "Specific sub-type if stated, e.g. 'Intruder alarm', 'Fire alarm', 'PIR activation'.",
    },
    source: {
      type: "string",
      enum: [...BOT_CALLOUT_SOURCES],
      description:
        "Where the job came from. ALARM for alarm activations; PARTNER_REQUEST if a partner asked us; CUSTOMER_REQUEST if the customer did; AD_HOC otherwise.",
    },
    priority: {
      type: "string",
      enum: ["LOW", "MEDIUM", "HIGH"],
      description: "Urgency if implied. Default MEDIUM.",
    },
    handlerKind: {
      type: "string",
      enum: ["officer", "partner"],
      description:
        "'partner' ONLY if the message says to give/sub the job to a partner company. Otherwise 'officer'.",
    },
    officerName: {
      type: "string",
      description:
        "The internal officer to assign, if one is named. Match to a known officer name when obvious.",
    },
    partnerName: {
      type: "string",
      description:
        "The partner company to hand it to, when handlerKind is 'partner'.",
    },
    partnerOfficerName: {
      type: "string",
      description: "The partner's own guard's name, if mentioned.",
    },
    scheduledFor: {
      type: "string",
      description:
        "When to attend, as 'YYYY-MM-DDTHH:MM' in UK local time. Omit entirely if immediate / unspecified.",
    },
    notes: {
      type: "string",
      description:
        "Any extra operational detail worth keeping (zone, keyholder, access instructions).",
    },
  },
  required: ["siteQuery", "type", "handlerKind"],
};

const LIST_ACTIVITIES_TOOL: ToolDef = {
  name: "list_activities",
  description:
    "List what's scheduled or was done on a given day (patrols, lock-ups, unlocks, static shifts, callouts). Use this when the dispatcher is ASKING about a day rather than creating a new callout.",
  schema: {
    type: "object",
    properties: {
      day: {
        type: "string",
        enum: ["today", "yesterday", "tomorrow"],
        description: "Which day they're asking about. Default today.",
      },
      siteQuery: {
        type: "string",
        description:
          "Optional site name to narrow the list to, if they named one.",
      },
    },
    required: ["day"],
  },
};

const CREATE_CALLOUT_TOOL: ToolDef = {
  name: "create_callout",
  description:
    "Record the structured details of a NEW callout the dispatcher wants created and assigned.",
  schema: CALLOUT_TOOL_SCHEMA,
};

function buildSystemPrompt(
  officers: PersonCandidate[],
  partners: PersonCandidate[],
  nowUk: string,
): string {
  return [
    "You are the dispatch assistant for 1st Nationwide, a UK security firm.",
    "A dispatcher will either (a) describe a NEW callout to create and assign, or (b) ASK what's scheduled or was done on a day. Choose the matching tool: create_callout for (a), list_activities for (b).",
    `The current date and time in the UK is ${nowUk}. Resolve relative times ('tonight', 'in an hour', '9pm') against it and return UK local wall-clock 'YYYY-MM-DDTHH:MM'.`,
    "For create_callout: only set handlerKind='partner' when the dispatcher clearly wants the job given to a partner company; otherwise it's an internal officer. Copy the site reference verbatim into siteQuery — do not guess a full site name.",
    officers.length
      ? `Known officers: ${officers.map((o) => o.name).join(", ")}.`
      : "No officers are on file.",
    partners.length
      ? `Known partner companies: ${partners.map((p) => p.name).join(", ")}.`
      : "No partners are on file.",
  ].join("\n");
}

export type RoutedMessage =
  | { kind: "create"; parsed: ParsedCallout }
  | { kind: "list"; day: string; siteQuery: string | null }
  | { kind: "error"; error: string };

/**
 * Classify a free-text message and pull its fields in one model call: is the
 * dispatcher creating a callout, or asking for a day's activities?
 */
export async function routeMessage(
  text: string,
  opts: { officers: PersonCandidate[]; partners: PersonCandidate[]; nowUk: string },
): Promise<RoutedMessage> {
  const res = await extractWithTools({
    system: buildSystemPrompt(opts.officers, opts.partners, opts.nowUk),
    userText: text,
    tools: [CREATE_CALLOUT_TOOL, LIST_ACTIVITIES_TOOL],
  });
  if (!res.ok) return { kind: "error", error: res.error };
  if (res.name === "list_activities") {
    const d = res.data ?? {};
    return {
      kind: "list",
      day: typeof d.day === "string" ? d.day : "today",
      siteQuery:
        typeof d.siteQuery === "string" && d.siteQuery.trim()
          ? d.siteQuery.trim()
          : null,
    };
  }
  return { kind: "create", parsed: (res.data ?? {}) as ParsedCallout };
}

// ── Inline-button callback_data (≤64 bytes) ────────────────────────────────

export function calloutConfirmData(draftId: string): string {
  return `coc:${draftId}`;
}
export function calloutCancelData(draftId: string): string {
  return `cox:${draftId}`;
}
export function decodeCalloutAction(
  data: string,
): { action: "confirm" | "cancel"; draftId: string } | null {
  const m = data.match(/^co([cx]):(.+)$/);
  if (!m) return null;
  return { action: m[1] === "c" ? "confirm" : "cancel", draftId: m[2] };
}
