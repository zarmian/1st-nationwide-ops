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
  /// Street + town, so search covers the address, not just the name.
  address?: string | null;
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
/** Everything about a site we search over, normalised. Includes the postcode
 *  both spaced and un-spaced so "br1" and "br13ab" both hit. */
function siteHaystack(s: SiteCandidate): string {
  const pc = s.postcode
    ? `${s.postcode} ${s.postcode.replace(/\s+/g, "")}`
    : "";
  return norm(`${s.name} ${s.code ?? ""} ${s.address ?? ""} ${pc}`);
}

/** Order a multi-match list so name hits come before address-only hits. */
function sortForDisplay(sites: SiteCandidate[], tokens: string[]): SiteCandidate[] {
  return [...sites].sort((a, b) => {
    const aName = tokens.filter((t) => norm(a.name).includes(t)).length;
    const bName = tokens.filter((t) => norm(b.name).includes(t)).length;
    if (aName !== bName) return bName - aName;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fuzzy site search across name, code, address and postcode. Multi-word
 * queries score by how many of their words appear anywhere in the site
 * (so "tesco downham" and "tesco br1" both land the right branch), and the
 * best-scoring sites win — every remaining tie is returned as "many" for the
 * caller to list. Exact code / name still short-circuit to a single hit.
 */
export function matchSite(query: string, sites: SiteCandidate[]): SiteMatch {
  const q = norm(query);
  if (!q) return { kind: "none" };

  const exactCode = sites.filter((s) => s.code && norm(s.code) === q);
  if (exactCode.length === 1) return { kind: "one", site: exactCode[0] };
  const exactName = sites.filter((s) => norm(s.name) === q);
  if (exactName.length === 1) return { kind: "one", site: exactName[0] };

  const tokens = q.split(" ").filter(Boolean);
  let best = 0;
  const scored = sites.map((s) => {
    const hay = siteHaystack(s);
    const score = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    if (score > best) best = score;
    return { s, score };
  });
  if (best === 0) return { kind: "none" };

  const top = scored.filter((x) => x.score === best).map((x) => x.s);
  if (top.length === 1) return { kind: "one", site: top[0] };
  return { kind: "many", sites: sortForDisplay(top, tokens) };
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

export type ScopeMatch =
  | { kind: "site"; id: string; label: string }
  | { kind: "customer"; id: string; label: string }
  | { kind: "partner"; id: string; label: string }
  | { kind: "none" };

function matchAccount(
  query: string,
  accounts: PersonCandidate[],
): PersonCandidate | null {
  const nq = norm(query);
  if (!nq) return null;
  const hits = accounts.filter((a) => {
    const n = norm(a.name);
    return n.includes(nq) || nq.includes(n);
  });
  if (hits.length === 0) return null;
  // Prefer the shortest name — the base account ("Shurgard") over a longer
  // variant — breaking ties alphabetically.
  return [...hits].sort(
    (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name),
  )[0];
}

/**
 * Resolve a free-text scope to a customer, partner or site. A specific site
 * wins ("Shurgard Neasden"); an account-level name falls to the customer or
 * partner ("Shurgard"); anything else (a greeting, a person's name) → none,
 * so the caller shows the whole schedule.
 */
export function resolveScope(
  query: string,
  ctx: {
    sites: SiteCandidate[];
    customers: PersonCandidate[];
    partners: PersonCandidate[];
  },
): ScopeMatch {
  const q = query.trim();
  if (!q) return { kind: "none" };
  const site = matchSite(q, ctx.sites);
  if (site.kind === "one") {
    return { kind: "site", id: site.site.id, label: site.site.name };
  }
  const cust = matchAccount(q, ctx.customers);
  if (cust) return { kind: "customer", id: cust.id, label: cust.name };
  const part = matchAccount(q, ctx.partners);
  if (part) return { kind: "partner", id: part.id, label: part.name };
  return { kind: "none" };
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
    "List the schedule / activities (patrols, lock-ups, unlocks, static shifts, callouts). Use for ANY ask about what's on or what was done — including a bare 'schedule', 'X schedule', 'what's on', or a customer/site name paired with a day ('Shurgard yesterday'). day='now' = live snapshot of what's in progress/overdue.",
  schema: {
    type: "object",
    properties: {
      day: {
        type: "string",
        enum: ["now", "today", "yesterday", "tomorrow"],
        description:
          "Which window. 'now' = live snapshot. Default to 'today' when unspecified (e.g. a bare 'schedule').",
      },
      scopeQuery: {
        type: "string",
        description:
          "Optional — narrow to a customer, partner or site if one is named (e.g. 'Shurgard', 'Neasden'). OMIT for the whole schedule, or when the leading word is just a greeting or a person's name (e.g. 'Zaryab schedule').",
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

const LOOKUP_SITE_TOOL: ToolDef = {
  name: "lookup_site",
  description:
    "Search sites by name, address, or postcode and show matches. Use for a bare site query ('tesco downham', 'tesco br1'), 'where is X', 'what's at X'. Lists every site that matches.",
  schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The words to search on — any mix of site name, street/area, or postcode.",
      },
    },
    required: ["query"],
  },
};

const LOOKUP_KEY_TOOL: ToolDef = {
  name: "lookup_key",
  description:
    "Look up keys and who currently holds them. Use for 'who has the keys for X', 'where's key 12'.",
  schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A key number, key label, or the site name.",
      },
    },
    required: ["query"],
  },
};

const JOB_TARGET_PROPS = {
  siteQuery: {
    type: "string",
    description: "The site of the existing job to act on.",
  },
  typeHint: {
    type: "string",
    description:
      "The job kind if the dispatcher named it (alarm, lock-up, unlock, patrol, VPI). Helps pick the right one.",
  },
} as const;

const REASSIGN_JOB_TOOL: ToolDef = {
  name: "reassign_job",
  description:
    "Move an EXISTING callout/job to a different officer. Use for 'move the Neasden alarm to Jane', 'reassign X to Y'.",
  schema: {
    type: "object",
    properties: {
      ...JOB_TARGET_PROPS,
      officerName: {
        type: "string",
        description: "The officer to move the job to.",
      },
    },
    required: ["siteQuery", "officerName"],
  },
};

const CANCEL_JOB_TOOL: ToolDef = {
  name: "cancel_job",
  description:
    "Cancel an EXISTING callout/job. Use for 'cancel the Norbury lock-up'.",
  schema: {
    type: "object",
    properties: { ...JOB_TARGET_PROPS },
    required: ["siteQuery"],
  },
};

const CLOSE_JOB_TOOL: ToolDef = {
  name: "close_job",
  description:
    "Mark an EXISTING scheduled activity (lock-up, unlock, patrol, VPI, alarm) as DONE. Use for any report that it happened — 'close the Neasden alarm', 'mark X complete', and crucially a bare past-tense statement like 'Norbury unlocked', 'Neasden locked', 'Croydon patrolled', 'Aegis House done'. Put the activity word in typeHint (lock / unlock / patrol / VPI / alarm).",
  schema: {
    type: "object",
    properties: { ...JOB_TARGET_PROPS },
    required: ["siteQuery"],
  },
};

const HELP_TOOL: ToolDef = {
  name: "smalltalk_or_help",
  description:
    "Use for greetings, thanks, small talk, 'what can you do', or anything that isn't one of the other actions. The bot replies conversationally.",
  schema: { type: "object", properties: {} },
};

function buildSystemPrompt(
  officers: PersonCandidate[],
  partners: PersonCandidate[],
  nowUk: string,
): string {
  return [
    "You are the dispatch assistant for 1st Nationwide, a UK security firm. Be warm and natural, and generalise — the phrasings below are examples, not the only wording.",
    "Pick the matching tool:",
    "• create a NEW callout → create_callout",
    "• the schedule / what's on / what was done — ANY wording, including a bare 'schedule', 'X schedule' (X is often just a greeting or a person's name — ignore it), or a customer/site with a day like 'Shurgard yesterday' → list_activities (set scopeQuery only to a real customer/partner/site)",
    "• SEARCH sites by name/address/postcode with NO day word ('tesco downham', 'tesco br1') → lookup_site",
    "• who holds keys → lookup_key",
    "• move an EXISTING job to another officer → reassign_job; cancel one → cancel_job; mark one done → close_job",
    "• greetings / thanks / 'what can you do' / anything else → smalltalk_or_help",
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
  | { kind: "list"; day: string; scopeQuery: string | null }
  | { kind: "lookupSite"; query: string }
  | { kind: "lookupKey"; query: string }
  | {
      kind: "reassignJob";
      siteQuery: string;
      typeHint: string | null;
      officerName: string;
    }
  | { kind: "cancelJob"; siteQuery: string; typeHint: string | null }
  | { kind: "closeJob"; siteQuery: string; typeHint: string | null }
  | { kind: "help" }
  | { kind: "error"; error: string };

/**
 * Classify a free-text message and pull its fields in one model call: create
 * a callout, list a day, look up a site, or look up keys.
 */
export async function routeMessage(
  text: string,
  opts: { officers: PersonCandidate[]; partners: PersonCandidate[]; nowUk: string },
): Promise<RoutedMessage> {
  const res = await extractWithTools({
    system: buildSystemPrompt(opts.officers, opts.partners, opts.nowUk),
    userText: text,
    tools: [
      CREATE_CALLOUT_TOOL,
      LIST_ACTIVITIES_TOOL,
      LOOKUP_SITE_TOOL,
      LOOKUP_KEY_TOOL,
      REASSIGN_JOB_TOOL,
      CANCEL_JOB_TOOL,
      CLOSE_JOB_TOOL,
      HELP_TOOL,
    ],
  });
  if (!res.ok) return { kind: "error", error: res.error };
  if (res.name === "smalltalk_or_help") return { kind: "help" };
  const d = res.data ?? {};
  const siteQuery = String(d.siteQuery ?? "").trim();
  const typeHint =
    typeof d.typeHint === "string" && d.typeHint.trim() ? d.typeHint.trim() : null;
  if (res.name === "reassign_job") {
    return {
      kind: "reassignJob",
      siteQuery,
      typeHint,
      officerName: String(d.officerName ?? "").trim(),
    };
  }
  if (res.name === "cancel_job") {
    return { kind: "cancelJob", siteQuery, typeHint };
  }
  if (res.name === "close_job") {
    return { kind: "closeJob", siteQuery, typeHint };
  }
  if (res.name === "lookup_site") {
    return { kind: "lookupSite", query: String(res.data?.query ?? "").trim() };
  }
  if (res.name === "lookup_key") {
    return { kind: "lookupKey", query: String(res.data?.query ?? "").trim() };
  }
  if (res.name === "list_activities") {
    const ld = res.data ?? {};
    return {
      kind: "list",
      day: typeof ld.day === "string" ? ld.day : "today",
      scopeQuery:
        typeof ld.scopeQuery === "string" && ld.scopeQuery.trim()
          ? ld.scopeQuery.trim()
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

// Officer job check-in/out buttons on the assignment ping.
export function jobActionData(
  action: "onsite" | "complete",
  jobId: string,
): string {
  return `jc${action === "onsite" ? "o" : "d"}:${jobId}`;
}
export function decodeJobAction(
  data: string,
): { action: "onsite" | "complete"; jobId: string } | null {
  const m = data.match(/^jc([od]):(.+)$/);
  if (!m) return null;
  return { action: m[1] === "o" ? "onsite" : "complete", jobId: m[2] };
}
