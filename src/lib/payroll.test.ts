import { describe, expect, it } from "vitest";
import {
  csvHeader,
  csvLineFor,
  monthsBetween,
  type PayrollRow,
} from "./payroll";

describe("monthsBetween", () => {
  it("returns 1 for a window inside a single month", () => {
    expect(
      monthsBetween(new Date(2026, 4, 1), new Date(2026, 4, 31, 23, 59)),
    ).toBe(1);
  });
  it("returns 2 spanning two months", () => {
    expect(
      monthsBetween(new Date(2026, 4, 15), new Date(2026, 5, 14)),
    ).toBe(2);
  });
  it("spans 12 months across a year boundary", () => {
    expect(
      monthsBetween(new Date(2026, 0, 1), new Date(2026, 11, 31)),
    ).toBe(12);
  });
  it("returns 0 when the window inverts", () => {
    expect(
      monthsBetween(new Date(2026, 5, 1), new Date(2026, 4, 1)),
    ).toBe(0);
  });
});

describe("csvLineFor / csvHeader", () => {
  const row: PayrollRow = {
    officerId: "11111111-1111-1111-1111-111111111111",
    name: "Hasnain",
    email: "hasnain@example.com",
    role: "OFFICER",
    siaNumber: "1010 2345 6789 0123",
    retainerAmount: 500,
    retainerCurrency: "GBP",
    retainerMonths: 1,
    activityPay: 234.5,
    activityCount: 12,
    adjustments: 0,
    total: 734.5,
    currency: "GBP",
  };

  it("quotes every cell", () => {
    expect(csvLineFor(row).startsWith('"')).toBe(true);
    expect(csvLineFor(row).endsWith('"')).toBe(true);
  });

  it("escapes internal quotes by doubling them", () => {
    const tricky: PayrollRow = { ...row, name: `O'Sullivan "Sully"` };
    expect(csvLineFor(tricky)).toContain(`"O'Sullivan ""Sully"""`);
  });

  it("formats amounts to 2 dp", () => {
    expect(csvLineFor(row)).toContain('"500.00"');
    expect(csvLineFor(row)).toContain('"234.50"');
    expect(csvLineFor(row)).toContain('"734.50"');
  });

  it("includes a signed adjustments column", () => {
    const withAdj: PayrollRow = { ...row, adjustments: -50 };
    expect(csvLineFor(withAdj)).toContain('"-50.00"');
  });

  it("header has the columns we promise", () => {
    expect(csvHeader()).toBe(
      [
        "officer_id",
        "name",
        "email",
        "role",
        "sia_number",
        "retainer_amount",
        "retainer_months",
        "activity_pay",
        "activity_count",
        "adjustments",
        "total",
        "currency",
      ]
        .map((c) => `"${c}"`)
        .join(","),
    );
  });
});
