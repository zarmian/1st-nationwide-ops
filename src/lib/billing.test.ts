import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  calculateBilling,
  calculatePay,
  durationMinutes,
  jobTypeToRateService,
} from "./billing";

type RateRow = {
  id: string;
  service:
    | "PATROL"
    | "ALARM_RESPONSE"
    | "LOCKUP"
    | "UNLOCK"
    | "VPI"
    | "STATIC_GUARDING"
    | "DOG_HANDLER"
    | "KEYHOLDING"
    | "ADHOC"
    | "ANNUAL_SUBSCRIPTION"
    | "SITE_SETUP";
  amount: Prisma.Decimal;
  currency: string;
  unit:
    | "PER_VISIT"
    | "PER_HOUR"
    | "PER_MONTH"
    | "PER_YEAR"
    | "FIXED";
  includedMinutes?: number | null;
  excessRatePerMin?: Prisma.Decimal | null;
};

function rate(
  service: RateRow["service"],
  amount: number,
  unit: RateRow["unit"] = "PER_VISIT",
  excess?: { included: number; perMin: number },
): RateRow {
  return {
    id: `rate-${service}-${unit}`,
    service,
    amount: new Prisma.Decimal(amount),
    currency: "GBP",
    unit,
    includedMinutes: excess?.included ?? null,
    excessRatePerMin: excess ? new Prisma.Decimal(excess.perMin) : null,
  };
}

describe("calculateBilling", () => {
  it("returns the per-visit amount when a match exists", () => {
    const rates = [rate("PATROL", 10.35), rate("ALARM_RESPONSE", 25.36)];
    const result = calculateBilling(rates, "PATROL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(10.35);
      expect(result.currency).toBe("GBP");
      expect(result.unit).toBe("PER_VISIT");
    }
  });

  it("misses when no rate exists for the service", () => {
    const rates = [rate("PATROL", 10)];
    const result = calculateBilling(rates, "ALARM_RESPONSE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_rate");
  });

  it("requires duration for PER_HOUR rates", () => {
    const rates = [rate("STATIC_GUARDING", 14.5, "PER_HOUR")];
    const noDuration = calculateBilling(rates, "STATIC_GUARDING");
    expect(noDuration.ok).toBe(false);
    if (!noDuration.ok) expect(noDuration.reason).toBe("duration_required");
  });

  it("multiplies PER_HOUR rate by hours from durationMinutes", () => {
    const rates = [rate("STATIC_GUARDING", 14.5, "PER_HOUR")];
    const r = calculateBilling(rates, "STATIC_GUARDING", 90);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(21.75);
  });

  it("rounds the per-hour result to 2dp", () => {
    const rates = [rate("STATIC_GUARDING", 13.337, "PER_HOUR")];
    const r = calculateBilling(rates, "STATIC_GUARDING", 60);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(13.34);
  });

  it("treats zero / negative duration as duration_required", () => {
    const rates = [rate("STATIC_GUARDING", 10, "PER_HOUR")];
    expect(calculateBilling(rates, "STATIC_GUARDING", 0).ok).toBe(false);
    expect(calculateBilling(rates, "STATIC_GUARDING", -30).ok).toBe(false);
  });

  describe("excess-time surcharge", () => {
    it("adds (duration - included) × perMin when over the included window", () => {
      const rates = [
        rate("ALARM_RESPONSE", 25, "PER_VISIT", {
          included: 30,
          perMin: 0.5,
        }),
      ];
      const r = calculateBilling(rates, "ALARM_RESPONSE", 50);
      expect(r.ok).toBe(true);
      // 25 base + (50 - 30) * 0.5 = 25 + 10 = 35
      if (r.ok) expect(r.amount).toBe(35);
    });

    it("charges only the base when duration is within included minutes", () => {
      const rates = [
        rate("ALARM_RESPONSE", 25, "PER_VISIT", {
          included: 30,
          perMin: 0.5,
        }),
      ];
      const r = calculateBilling(rates, "ALARM_RESPONSE", 25);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.amount).toBe(25);
    });

    it("ignores excess config when duration is null", () => {
      const rates = [
        rate("ALARM_RESPONSE", 25, "PER_VISIT", {
          included: 30,
          perMin: 0.5,
        }),
      ];
      const r = calculateBilling(rates, "ALARM_RESPONSE", null);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.amount).toBe(25);
    });

    it("rounds the excess-inclusive total to 2 dp", () => {
      const rates = [
        rate("ALARM_RESPONSE", 10, "PER_VISIT", {
          included: 30,
          perMin: 0.1725,
        }),
      ];
      const r = calculateBilling(rates, "ALARM_RESPONSE", 47);
      // 10 + 17 * 0.1725 = 10 + 2.9325 → 12.93 (banker's-not — Math.round)
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.amount).toBe(12.93);
    });
  });
});

describe("calculatePay", () => {
  type PayRate = {
    id: string;
    officerId: string | null;
    service: RateRow["service"];
    amount: Prisma.Decimal;
    currency: string;
    unit: RateRow["unit"];
  };

  function payRate(
    officerId: string | null,
    service: PayRate["service"],
    amount: number,
    unit: PayRate["unit"] = "PER_VISIT",
  ): PayRate {
    return {
      id: `${officerId ?? "default"}-${service}-${unit}`,
      officerId,
      service,
      amount: new Prisma.Decimal(amount),
      currency: "GBP",
      unit,
    };
  }

  it("returns the per-officer rate when one exists", () => {
    const rates = [
      payRate(null, "ALARM_RESPONSE", 10), // company default
      payRate("officer-1", "ALARM_RESPONSE", 15), // per-officer override
    ];
    const r = calculatePay(rates, "officer-1", "ALARM_RESPONSE");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(15);
  });

  it("falls back to the company default when no per-officer rate", () => {
    const rates = [payRate(null, "ALARM_RESPONSE", 10)];
    const r = calculatePay(rates, "officer-1", "ALARM_RESPONSE");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(10);
  });

  it("misses when neither per-officer nor default exists", () => {
    const rates = [payRate(null, "PATROL", 5)];
    const r = calculatePay(rates, "officer-1", "ALARM_RESPONSE");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_rate");
  });

  it("multiplies PER_HOUR pay rate by hours from duration", () => {
    const rates = [payRate(null, "STATIC_GUARDING", 12, "PER_HOUR")];
    const r = calculatePay(rates, "officer-1", "STATIC_GUARDING", 120);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(24);
  });

  it("requires duration for PER_HOUR pay", () => {
    const rates = [payRate(null, "STATIC_GUARDING", 12, "PER_HOUR")];
    const r = calculatePay(rates, "officer-1", "STATIC_GUARDING");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duration_required");
  });
});

describe("jobTypeToRateService", () => {
  it.each([
    ["ALARM_RESPONSE", "ALARM_RESPONSE"],
    ["PATROL", "PATROL"],
    ["LOCK", "LOCKUP"],
    ["UNLOCK", "UNLOCK"],
    ["KEY_COLLECTION", "KEYHOLDING"],
    ["KEY_DROPOFF", "KEYHOLDING"],
    ["VPI", "VPI"],
    ["ADHOC", "ADHOC"],
    ["STATIC_GUARDING_SHIFT", "STATIC_GUARDING"],
    ["DOG_HANDLER_SHIFT", "DOG_HANDLER"],
  ])("maps %s → %s", (jobType, expected) => {
    expect(jobTypeToRateService(jobType)).toBe(expected);
  });

  it("returns null for unmapped types", () => {
    expect(jobTypeToRateService("SURVEY")).toBeNull();
    expect(jobTypeToRateService("UNKNOWN")).toBeNull();
  });
});

describe("durationMinutes", () => {
  it("returns minutes between arrival and departure", () => {
    const a = new Date("2026-05-01T18:00:00Z");
    const b = new Date("2026-05-01T18:45:00Z");
    expect(durationMinutes(a, b)).toBe(45);
  });

  it("returns null when either side is missing", () => {
    expect(durationMinutes(null, new Date())).toBeNull();
    expect(durationMinutes(new Date(), null)).toBeNull();
  });

  it("returns null when departure is before / equal arrival", () => {
    const a = new Date("2026-05-01T18:00:00Z");
    const before = new Date("2026-05-01T17:59:59Z");
    expect(durationMinutes(a, a)).toBeNull();
    expect(durationMinutes(a, before)).toBeNull();
  });
});
