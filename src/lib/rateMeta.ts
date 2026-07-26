/**
 * Canonical service + unit lists and labels for customer-facing rates,
 * shared by the customer / site rate editors and their display tables.
 * (The officer-pay editor predates this and keeps its own copy.)
 */

export const RATE_SERVICES = [
  "ALARM_RESPONSE",
  "KEYHOLDING",
  "LOCKUP",
  "UNLOCK",
  "VPI",
  "PATROL",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
  "ANNUAL_SUBSCRIPTION",
  "SITE_SETUP",
] as const;
export type RateServiceCode = (typeof RATE_SERVICES)[number];

export const RATE_UNITS = [
  "PER_VISIT",
  "PER_HOUR",
  "PER_MONTH",
  "PER_YEAR",
  "FIXED",
] as const;
export type RateUnitCode = (typeof RATE_UNITS)[number];

export const SERVICE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  KEYHOLDING: "Keyholding",
  LOCKUP: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  PATROL: "Patrol",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
  ADHOC: "Ad-hoc",
  ANNUAL_SUBSCRIPTION: "Subscription",
  SITE_SETUP: "Site setup (one-off)",
};

export const UNIT_LABEL: Record<string, string> = {
  PER_VISIT: "per visit",
  PER_HOUR: "per hour",
  PER_MONTH: "per month",
  PER_YEAR: "per year",
  FIXED: "fixed (one-off)",
};

export const SERVICE_OPTIONS = RATE_SERVICES.map((v) => ({
  v,
  label: SERVICE_LABEL[v] ?? v,
}));
export const UNIT_OPTIONS = RATE_UNITS.map((v) => ({
  v,
  label: UNIT_LABEL[v] ?? v,
}));

export function fmtMoney(amount: unknown, currency = "GBP"): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}

/** Shared useFormState shape for the rate editors. */
export type RateFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  ok?: boolean;
};
