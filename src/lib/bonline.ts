/**
 * bOnline call-webhook payload parser.
 *
 * IMPORTANT: bOnline's exact payload shape isn't documented to us yet, so
 * this is a DEFENSIVE, best-effort normaliser: it probes the common field
 * names phone providers use, never throws, and defaults to "not missed"
 * when unsure (so we never fire a false dispatch alert). The raw payload is
 * always stored by the webhook route, so once a real call is captured we
 * tighten the field mapping + missed-call detection here.
 *
 * Pure function — unit-tested — no DB or network access.
 */

export type NormalisedCall = {
  externalId: string | null;
  direction: "INBOUND" | "OUTBOUND" | "UNKNOWN";
  status: string; // MISSED | ANSWERED | BUSY | FAILED | VOICEMAIL | UNKNOWN
  rawStatus: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  durationSec: number | null;
  occurredAt: Date | null;
  missed: boolean;
};

type AnyRecord = Record<string, unknown>;

/** Flatten one level of a common wrapper key so `payload.call.from` etc. is
 *  reachable, then treat the merged object as a flat bag of candidates. */
function flatten(payload: unknown): AnyRecord {
  if (!payload || typeof payload !== "object") return {};
  const top = payload as AnyRecord;
  const merged: AnyRecord = { ...top };
  for (const wrapper of ["data", "call", "event", "payload", "cdr", "body"]) {
    const inner = top[wrapper];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      Object.assign(merged, inner as AnyRecord);
    }
  }
  return merged;
}

/** First present, non-empty value among candidate keys (case-insensitive). */
function pick(bag: AnyRecord, keys: string[]): unknown {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(bag)) lower.set(k.toLowerCase(), v);
  for (const key of keys) {
    const v = lower.get(key.toLowerCase());
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|1|yes)$/i.test(v.trim())) return true;
    if (/^(false|0|no)$/i.test(v.trim())) return false;
  }
  return null;
}

function parseTime(v: unknown): Date | null {
  if (v == null) return null;
  // epoch seconds or millis
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000; // <1e12 → looks like seconds
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n)) return parseTime(n);
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

const MISSED_RE = /miss|no[\s_-]?answer|unanswered|not[\s_-]?answered|abandon/i;
const ANSWERED_RE = /answer|complete|connected|bridged/i;
const BUSY_RE = /busy/i;
const VOICEMAIL_RE = /voice[\s_-]?mail|vm/i;
const FAILED_RE = /fail|reject|declin|cancel|error/i;

export function parseBonlineCall(payload: unknown): NormalisedCall {
  const bag = flatten(payload);

  const externalId =
    asString(pick(bag, ["callId", "call_id", "id", "uuid", "sessionId", "reference", "ref"])) ??
    null;

  const dirRaw = (
    asString(pick(bag, ["direction", "callDirection", "call_type", "callType", "type"])) ?? ""
  ).toLowerCase();
  const direction: NormalisedCall["direction"] = /out/.test(dirRaw)
    ? "OUTBOUND"
    : /in/.test(dirRaw)
      ? "INBOUND"
      : "UNKNOWN";

  const rawStatus =
    asString(
      pick(bag, [
        "status",
        "disposition",
        "state",
        "result",
        "callStatus",
        "call_status",
        "outcome",
        "event",
        "eventType",
        "event_type",
      ]),
    ) ?? null;

  const fromNumber = asString(
    pick(bag, ["from", "from_number", "fromNumber", "caller", "callerId", "callerNumber", "source", "aNumber", "ani"]),
  );
  const toNumber = asString(
    pick(bag, ["to", "to_number", "toNumber", "callee", "destination", "dialled", "dialed", "bNumber", "dnis"]),
  );

  const durationSec = asNumber(
    pick(bag, ["durationSec", "duration", "duration_seconds", "talk_time", "talkTime", "billsec", "seconds"]),
  );

  const occurredAt = parseTime(
    pick(bag, ["occurredAt", "timestamp", "time", "startTime", "start_time", "date", "datetime", "created", "createdAt", "eventTime"]),
  );

  // Missed detection — a dedicated boolean wins; otherwise match the raw
  // status/event text. A "missed" event type also counts.
  const missedFlag = pick(bag, ["missed", "isMissed", "is_missed"]);
  let missed: boolean;
  if (typeof missedFlag === "boolean") {
    missed = missedFlag;
  } else if (rawStatus && MISSED_RE.test(rawStatus)) {
    missed = true;
  } else {
    missed = false;
  }

  // Normalised status label for the log.
  let status = "UNKNOWN";
  if (missed) status = "MISSED";
  else if (rawStatus && VOICEMAIL_RE.test(rawStatus)) status = "VOICEMAIL";
  else if (rawStatus && BUSY_RE.test(rawStatus)) status = "BUSY";
  else if (rawStatus && ANSWERED_RE.test(rawStatus)) status = "ANSWERED";
  else if (rawStatus && FAILED_RE.test(rawStatus)) status = "FAILED";

  return {
    externalId,
    direction,
    status,
    rawStatus,
    fromNumber,
    toNumber,
    durationSec,
    occurredAt,
    missed,
  };
}

// ── bOnline call-state feed (per-leg webhooks) ──────────────────────────────
//
// bOnline's webhook isn't one-event-per-call: it pushes a webhook per call
// *leg* (SIP channel), all sharing a `conversation_id`. A single inbound call
// arrives as several legs — the external caller's channel plus one channel per
// ringing extension — so we group by conversation_id and derive the call-level
// outcome (answered vs missed) from the legs together.

export type BonlineLeg = {
  legId: string | null; // call_id — unique per leg
  conversationId: string | null; // shared across a call's legs
  isCaller: boolean; // true for the originating channel
  userUuid: string | null; // set when this leg is one of OUR users' handsets
  directionRaw: string | null; // provider's own "inbound"/"outbound"/"internal"
  callerNumber: string | null; // caller_id_number
  peerNumber: string | null; // peer_caller_id_number
  dialedNumber: string | null; // dialed_extension (the number dialled)
  providerStatus: string | null; // "Up" | "Ringing" | "Down" | ...
  reasonCode: number | null; // Q.850 hangup cause (16 = normal)
  creationTime: Date | null;
  answerTime: Date | null; // set once this leg is answered
  hangupTime: Date | null;
};

/** True when a payload looks like a bOnline call-state leg (vs a generic
 *  one-shot call webhook), so the webhook route knows to group by conversation. */
export function isBonlineLegShape(payload: unknown): boolean {
  const bag = flatten(payload);
  const hasConversation =
    pick(bag, ["conversation_id", "conversationId"]) !== undefined;
  const hasLegFields =
    pick(bag, ["call_id", "callId"]) !== undefined &&
    pick(bag, [
      "caller_id_number",
      "dialed_extension",
      "peer_caller_id_number",
      "is_caller",
    ]) !== undefined;
  return hasConversation || hasLegFields;
}

export function parseBonlineLeg(payload: unknown): BonlineLeg {
  const bag = flatten(payload);
  return {
    legId: asString(pick(bag, ["call_id", "callId", "id"])),
    conversationId: asString(
      pick(bag, ["conversation_id", "conversationId"]),
    ),
    isCaller: asBool(pick(bag, ["is_caller", "isCaller"])) ?? false,
    userUuid: asString(pick(bag, ["user_uuid", "userUuid"])),
    directionRaw: asString(pick(bag, ["direction", "callDirection"])),
    callerNumber: asString(pick(bag, ["caller_id_number", "callerIdNumber"])),
    peerNumber: asString(
      pick(bag, ["peer_caller_id_number", "peerCallerIdNumber"]),
    ),
    dialedNumber: asString(
      pick(bag, ["dialed_extension", "dialedExtension", "dialed_number"]),
    ),
    providerStatus: asString(pick(bag, ["status", "state"])),
    reasonCode: asNumber(pick(bag, ["reason_code", "reasonCode"])),
    creationTime: parseTime(pick(bag, ["creation_time", "creationTime"])),
    answerTime: parseTime(pick(bag, ["answer_time", "answerTime"])),
    hangupTime: parseTime(pick(bag, ["hangup_time", "hangupTime"])),
  };
}

export type DerivedCall = {
  fromNumber: string | null;
  toNumber: string | null;
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL" | "UNKNOWN";
  status: string; // ANSWERED | MISSED | IN_PROGRESS | UNKNOWN
  missed: boolean;
  answered: boolean;
  ended: boolean;
  occurredAt: Date | null;
  durationSec: number | null;
};

/** Looks like a real external phone number rather than a short internal
 *  extension (so we don't raise "missed call" alerts for extension-to-extension
 *  internal calls). */
export function isExternalNumber(number: string | null | undefined): boolean {
  if (!number) return false;
  const digits = number.replace(/[^\d+]/g, "").replace(/^\+/, "");
  return digits.length >= 7;
}

function earliest(dates: (Date | null)[]): Date | null {
  const ms = dates.filter((d): d is Date => d != null).map((d) => d.getTime());
  return ms.length ? new Date(Math.min(...ms)) : null;
}
function latest(dates: (Date | null)[]): Date | null {
  const ms = dates.filter((d): d is Date => d != null).map((d) => d.getTime());
  return ms.length ? new Date(Math.max(...ms)) : null;
}

/** Comparable digits for a UK number: strip formatting and the 44/0 prefix so
 *  "+442081678180", "442081678180" and "02081678180" all compare equal. */
function normNum(n: string | null | undefined): string {
  if (!n) return "";
  let d = n.replace(/[^\d]/g, "");
  if (d.startsWith("44")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * Fold a call's legs into one call-level outcome.
 *   answered — the far (non-caller) leg was answered.
 *   ended    — the caller's own leg has hung up (or every leg has).
 *   missed   — an INBOUND call that ended with nobody answering.
 * Direction comes from which side started the call: our own user's handset
 * (a leg with user_uuid) placing it = OUTBOUND, otherwise INBOUND. bOnline's
 * own `direction` field ("outbound"/"inbound") wins when it isn't "internal".
 * Recomputed from all known legs on every webhook, so it's order-independent.
 */
export function deriveCallFromLegs(legs: BonlineLeg[]): DerivedCall {
  if (legs.length === 0) {
    return {
      fromNumber: null,
      toNumber: null,
      direction: "UNKNOWN",
      status: "UNKNOWN",
      missed: false,
      answered: false,
      ended: false,
      occurredAt: null,
      durationSec: null,
    };
  }

  const agentLegs = legs.filter((l) => !l.isCaller);
  const callerLegs = legs.filter((l) => l.isCaller);

  // Direction. Prefer an explicit provider label; else infer from whether the
  // originating leg is one of our own users (has a user_uuid).
  const explicit = legs
    .map((l) => l.directionRaw?.toLowerCase())
    .find((d) => d === "outbound" || d === "inbound");
  let direction: DerivedCall["direction"];
  if (explicit === "outbound") direction = "OUTBOUND";
  else if (explicit === "inbound") direction = "INBOUND";
  else {
    const callerLeg = callerLegs[0];
    if (callerLeg) direction = callerLeg.userUuid ? "OUTBOUND" : "INBOUND";
    else direction = "UNKNOWN";
  }

  // to = the number that was dialled (consistent across legs & directions).
  // from = the other party on the call (the caller/peer number that isn't the
  // dialled number) — robust to bOnline swapping caller_id/peer between legs.
  const toNumber =
    legs.map((l) => l.dialedNumber).find((n) => n && n.trim() !== "") ?? null;
  const toNorm = normNum(toNumber);
  const candidates: string[] = [];
  for (const l of legs) {
    for (const n of [l.callerNumber, l.peerNumber]) {
      if (n && n.trim() !== "") candidates.push(n);
    }
  }
  const fromNumber =
    candidates.find((n) => normNum(n) !== "" && normNum(n) !== toNorm) ??
    candidates[0] ??
    null;

  const occurredAt = earliest(legs.map((l) => l.creationTime ?? l.answerTime));

  const answered = agentLegs.some((l) => l.answerTime != null);
  // Prefer the caller leg's hangup as "call over"; if we haven't seen a caller
  // leg, treat all-legs-hung-up as over.
  const ended =
    callerLegs.some((l) => l.hangupTime != null) ||
    (callerLegs.length === 0 && legs.every((l) => l.hangupTime != null));

  // A missed call is an INBOUND call nobody answered. An unanswered OUTBOUND
  // call is "no answer" — not something to alert the office about.
  const missed = !answered && ended && direction !== "OUTBOUND";

  let status = "IN_PROGRESS";
  if (answered) status = "ANSWERED";
  else if (ended) status = direction === "OUTBOUND" ? "NO_ANSWER" : "MISSED";

  let durationSec: number | null = null;
  if (answered) {
    const answeredAt = earliest(agentLegs.map((l) => l.answerTime));
    const endedAt = latest(legs.map((l) => l.hangupTime));
    if (answeredAt && endedAt) {
      durationSec = Math.max(
        0,
        Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000),
      );
    }
  }

  return {
    fromNumber,
    toNumber,
    direction,
    status,
    missed,
    answered,
    ended,
    occurredAt,
    durationSec,
  };
}

/** UK mobile check — only mobiles can receive our SMS alert echo of the
 *  caller's number is informational, but we never try to text a landline. */
export function isUkMobile(number: string | null | undefined): boolean {
  if (!number) return false;
  const t = number.replace(/[\s()-]/g, "");
  return /^07\d{9}$/.test(t) || /^\+447\d{9}$/.test(t);
}
