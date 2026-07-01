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

/** UK mobile check — only mobiles can receive our SMS alert echo of the
 *  caller's number is informational, but we never try to text a landline. */
export function isUkMobile(number: string | null | undefined): boolean {
  if (!number) return false;
  const t = number.replace(/[\s()-]/g, "");
  return /^07\d{9}$/.test(t) || /^\+447\d{9}$/.test(t);
}
