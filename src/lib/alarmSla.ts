/**
 * Alarm-response SLA: response-time targets and how a given alarm is tracking
 * against them.
 *
 * "Response time" is the time from the alarm being received to an officer
 * being on site — i.e. AlarmEvent.receivedAt → Job.startedAt. There is no
 * stored target, so we use sensible per-priority defaults (typical UK
 * keyholding response windows); a per-site contractual override can be layered
 * on later without changing this contract.
 */
import type { AlarmPriority } from "@prisma/client";

/** Default response-time targets (minutes) by alarm priority. */
export const DEFAULT_SLA_TARGET_MINS: Record<AlarmPriority, number> = {
  HIGH: 20,
  MEDIUM: 45,
  LOW: 90,
};

/** Fraction of the target elapsed at which an in-flight response is "at risk". */
const AT_RISK_FRACTION = 0.8;

export function targetMinsFor(
  priority: AlarmPriority,
  overrideMins?: number | null,
): number {
  if (overrideMins != null && overrideMins > 0) return overrideMins;
  return DEFAULT_SLA_TARGET_MINS[priority] ?? DEFAULT_SLA_TARGET_MINS.MEDIUM;
}

export type AlarmSlaStatus =
  | "responding" // still en route, comfortably within target
  | "at_risk" // still en route, into the last fifth of the window
  | "breached" // target passed with no arrival, or arrived after target
  | "met"; // arrived within target

export type AlarmSlaResult = {
  targetMins: number;
  /** received → (arrived ?? now). */
  elapsedMins: number;
  /** received → arrived, once on site (else null). */
  responseMins: number | null;
  /** target − elapsed while still responding (can be negative); null once arrived. */
  remainingMins: number | null;
  status: AlarmSlaStatus;
  arrived: boolean;
};

export function computeAlarmSla(input: {
  receivedAt: Date;
  /** Job.startedAt — the on-site stamp; null until the officer attends. */
  arrivedAt: Date | null;
  priority: AlarmPriority;
  targetOverrideMins?: number | null;
  now?: Date;
}): AlarmSlaResult {
  const now = input.now ?? new Date();
  const targetMins = targetMinsFor(input.priority, input.targetOverrideMins);
  const arrived = input.arrivedAt != null;
  const endMs = (input.arrivedAt ?? now).getTime();
  const elapsedMins = Math.max(
    0,
    Math.round((endMs - input.receivedAt.getTime()) / 60000),
  );

  if (arrived) {
    const status: AlarmSlaStatus = elapsedMins <= targetMins ? "met" : "breached";
    return {
      targetMins,
      elapsedMins,
      responseMins: elapsedMins,
      remainingMins: null,
      status,
      arrived,
    };
  }

  const remainingMins = targetMins - elapsedMins;
  let status: AlarmSlaStatus;
  if (remainingMins < 0) status = "breached";
  else if (elapsedMins >= targetMins * AT_RISK_FRACTION) status = "at_risk";
  else status = "responding";

  return {
    targetMins,
    elapsedMins,
    responseMins: null,
    remainingMins,
    status,
    arrived,
  };
}

/** Chip class + label per SLA status, for the register / dispatch board. */
export const SLA_CHIP: Record<AlarmSlaStatus, { chip: string; label: string }> = {
  responding: { chip: "chip-info", label: "Responding" },
  at_risk: { chip: "chip-amber", label: "At risk" },
  breached: { chip: "chip-red", label: "Breached" },
  met: { chip: "chip-green", label: "Met" },
};

/** A short countdown/response label to sit next to the SLA chip. */
export function slaTimingLabel(r: AlarmSlaResult): string {
  if (r.arrived) return `${r.responseMins}m to attend`;
  if (r.remainingMins == null) return "";
  return r.remainingMins >= 0
    ? `${r.remainingMins}m to target`
    : `${Math.abs(r.remainingMins)}m over`;
}

export type AlarmSlaRow = {
  status: AlarmSlaStatus;
  responseMins: number | null;
  arrived: boolean;
};

export type AlarmSlaSummary = {
  total: number;
  open: number; // still responding (not yet on site)
  arrived: number; // has an on-site stamp
  met: number;
  breached: number;
  atRisk: number;
  avgResponseMins: number | null;
  slaMetPct: number | null; // met ÷ arrived
};

/** Roll a set of computed alarm SLAs into KPI counters. */
export function summariseAlarmSla(rows: AlarmSlaRow[]): AlarmSlaSummary {
  let open = 0;
  let arrived = 0;
  let met = 0;
  let breached = 0;
  let atRisk = 0;
  let respTotal = 0;
  let respCount = 0;

  for (const r of rows) {
    if (r.arrived) {
      arrived++;
      if (r.responseMins != null) {
        respTotal += r.responseMins;
        respCount++;
      }
      if (r.status === "met") met++;
      else if (r.status === "breached") breached++;
    } else {
      open++;
      if (r.status === "breached") breached++;
      else if (r.status === "at_risk") atRisk++;
    }
  }

  return {
    total: rows.length,
    open,
    arrived,
    met,
    breached,
    atRisk,
    avgResponseMins: respCount ? Math.round(respTotal / respCount) : null,
    slaMetPct: arrived ? Math.round((met / arrived) * 100) : null,
  };
}
