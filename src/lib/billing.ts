/**
 * Billing calculator — resolves a customer-facing rate for an activity and
 * computes the amount to bill, given the activity's site, service type,
 * and (when relevant) actual duration.
 *
 * Design rules:
 *   1. Pure function. Takes a SiteRate[] (already loaded) and an activity
 *      descriptor. Returns a structured outcome. No Prisma access here so
 *      it's trivial to unit-test.
 *   2. Snapshot model: the amount is written once onto the activity row
 *      (PatrolVisit.billedAmount / Job.billedAmount). Future rate changes
 *      don't retroactively alter past invoices.
 *   3. Per-hour rates need a duration. We accept it explicitly rather than
 *      derive it inside the function to keep it pure and testable.
 */
import { Prisma } from "@prisma/client";
import type { RateService, RateUnit, SiteRate } from "@prisma/client";
import { prisma } from "@/lib/db";

export type BillingCalc = {
  amount: number;
  currency: string;
  service: RateService;
  unit: RateUnit;
  matchedRateId: string;
};

export type BillingMiss =
  | { ok: false; reason: "no_rate"; service: RateService }
  | { ok: false; reason: "duration_required"; service: RateService };

export type BillingResult = ({ ok: true } & BillingCalc) | BillingMiss;

/**
 * Pure calculator. Picks the most recently updated active rate matching
 * `service` from the supplied `rates` array (already scoped to one site).
 * For PER_HOUR rates `durationMinutes` is required; everything else is
 * rate.amount as a one-off charge.
 */
export function calculateBilling(
  rates: Pick<SiteRate, "id" | "service" | "amount" | "currency" | "unit">[],
  service: RateService,
  durationMinutes: number | null = null,
): BillingResult {
  const matched = rates.filter((r) => r.service === service);
  if (matched.length === 0) return { ok: false, reason: "no_rate", service };
  // If multiple rates exist for the same service (no validFrom/To pruning at
  // this level), prefer the largest amount as the "active" one. Real
  // rate-history support comes later.
  const rate = matched[0];

  if (rate.unit === "PER_HOUR") {
    if (durationMinutes == null || durationMinutes <= 0) {
      return { ok: false, reason: "duration_required", service };
    }
    const hours = durationMinutes / 60;
    const amount = Number(rate.amount) * hours;
    return {
      ok: true,
      amount: round2(amount),
      currency: rate.currency,
      service,
      unit: rate.unit,
      matchedRateId: rate.id,
    };
  }

  return {
    ok: true,
    amount: round2(Number(rate.amount)),
    currency: rate.currency,
    service,
    unit: rate.unit,
    matchedRateId: rate.id,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Map an internal JobType / form type to the corresponding RateService.
 * Returned `null` means "this activity type isn't priced" (e.g. SURVEY).
 */
export function jobTypeToRateService(jobType: string): RateService | null {
  switch (jobType) {
    case "ALARM_RESPONSE":
      return "ALARM_RESPONSE";
    case "PATROL":
      return "PATROL";
    case "LOCK":
      return "LOCKUP";
    case "UNLOCK":
      return "UNLOCK";
    case "KEY_COLLECTION":
    case "KEY_DROPOFF":
      return "KEYHOLDING";
    case "VPI":
      return "VPI";
    case "ADHOC":
      return "ADHOC";
    case "STATIC_GUARDING_SHIFT":
      return "STATIC_GUARDING";
    case "DOG_HANDLER_SHIFT":
      return "DOG_HANDLER";
    default:
      return null;
  }
}

export function durationMinutes(
  arrivedAt: Date | null,
  departedAt: Date | null,
): number | null {
  if (!arrivedAt || !departedAt) return null;
  const ms = departedAt.getTime() - arrivedAt.getTime();
  if (ms <= 0) return null;
  return Math.round(ms / 60000);
}

// ── DB helpers ────────────────────────────────────────────────────────────

/**
 * Load active rates for a site and apply calculateBilling. Convenience for
 * the call sites in /api/submissions and the job-creation actions.
 */
export async function billForSite(
  siteId: string,
  service: RateService,
  durationMinutes: number | null = null,
): Promise<BillingResult> {
  const rates = await prisma.siteRate.findMany({
    where: { siteId },
    select: {
      id: true,
      service: true,
      amount: true,
      currency: true,
      unit: true,
    },
  });
  return calculateBilling(rates, service, durationMinutes);
}

/**
 * Apply the result of calculateBilling to a PatrolVisit row. Idempotent —
 * recalculation is fine to re-run; we always overwrite the snapshot.
 */
export async function applyBillingToVisit(
  visitId: string,
  result: BillingResult,
): Promise<void> {
  if (!result.ok) {
    await prisma.patrolVisit.update({
      where: { id: visitId },
      data: {
        billedAmount: null,
        billedCurrency: null,
        billedAt: null,
        payRateUnit: null,
      },
    });
    return;
  }
  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: {
      billedAmount: new Prisma.Decimal(result.amount),
      billedCurrency: result.currency,
      billedAt: new Date(),
      payRateUnit: result.unit,
    },
  });
}

export async function applyBillingToJob(
  jobId: string,
  result: BillingResult,
): Promise<void> {
  if (!result.ok) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        billedAmount: null,
        billedCurrency: null,
        billedAt: null,
        payRateUnit: null,
      },
    });
    return;
  }
  await prisma.job.update({
    where: { id: jobId },
    data: {
      billedAmount: new Prisma.Decimal(result.amount),
      billedCurrency: result.currency,
      billedAt: new Date(),
      payRateUnit: result.unit,
    },
  });
}

// ── Officer pay ───────────────────────────────────────────────────────────

/**
 * Compute officer pay for one activity, using the OfficerRate rows already
 * loaded. Per-officer rates win over company defaults (officerId = null).
 * Same shape as calculateBilling so callers handle no_rate / duration_required
 * symmetrically.
 */
export function calculatePay(
  rates: Pick<
    { id: string; officerId: string | null; service: RateService; amount: Prisma.Decimal | number; currency: string; unit: RateUnit },
    "id" | "officerId" | "service" | "amount" | "currency" | "unit"
  >[],
  officerId: string,
  service: RateService,
  durationMinutes: number | null = null,
): BillingResult {
  // Prefer a per-officer rate for the service; fall back to the company
  // default (officerId === null).
  const officerSpecific = rates.find(
    (r) => r.officerId === officerId && r.service === service,
  );
  const companyDefault = rates.find(
    (r) => r.officerId === null && r.service === service,
  );
  const rate = officerSpecific ?? companyDefault;
  if (!rate) return { ok: false, reason: "no_rate", service };

  if (rate.unit === "PER_HOUR") {
    if (durationMinutes == null || durationMinutes <= 0) {
      return { ok: false, reason: "duration_required", service };
    }
    const hours = durationMinutes / 60;
    return {
      ok: true,
      amount: round2(Number(rate.amount) * hours),
      currency: rate.currency,
      service,
      unit: rate.unit,
      matchedRateId: rate.id,
    };
  }

  return {
    ok: true,
    amount: round2(Number(rate.amount)),
    currency: rate.currency,
    service,
    unit: rate.unit,
    matchedRateId: rate.id,
  };
}

/** Convenience: load all OfficerRates and resolve pay for one activity. */
export async function payForOfficer(
  officerId: string,
  service: RateService,
  durationMinutes: number | null = null,
): Promise<BillingResult> {
  const rates = await prisma.officerRate.findMany({
    where: {
      service,
      OR: [{ officerId }, { officerId: null }],
    },
    select: {
      id: true,
      officerId: true,
      service: true,
      amount: true,
      currency: true,
      unit: true,
    },
  });
  return calculatePay(rates, officerId, service, durationMinutes);
}

export async function applyPayToVisit(
  visitId: string,
  result: BillingResult,
): Promise<void> {
  if (!result.ok) {
    await prisma.patrolVisit.update({
      where: { id: visitId },
      data: { paidAmount: null, paidCurrency: null, paidAt: null },
    });
    return;
  }
  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: {
      paidAmount: new Prisma.Decimal(result.amount),
      paidCurrency: result.currency,
      paidAt: new Date(),
    },
  });
}

export async function applyPayToJob(
  jobId: string,
  result: BillingResult,
): Promise<void> {
  if (!result.ok) {
    await prisma.job.update({
      where: { id: jobId },
      data: { paidAmount: null, paidCurrency: null, paidAt: null },
    });
    return;
  }
  await prisma.job.update({
    where: { id: jobId },
    data: {
      paidAmount: new Prisma.Decimal(result.amount),
      paidCurrency: result.currency,
      paidAt: new Date(),
    },
  });
}
