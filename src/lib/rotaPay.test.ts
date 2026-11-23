import { describe, expect, it } from "vitest";
import { parseIsoDate } from "./dates";
import { countsInWindow, priceSouthShifts, southShiftRate } from "./rotaPay";

describe("priceSouthShifts", () => {
  it("pays each shift its rate", () => {
    const pay = priceSouthShifts({ DAY: 4, NIGHT: 5 }, { DAY: 80, NIGHT: 95.5 });
    expect(pay.lines.map((l) => [l.shift, l.count, l.amount])).toEqual([
      ["DAY", 4, 320],
      ["NIGHT", 5, 477.5],
    ]);
    expect(pay.shifts).toBe(9);
    expect(pay.amount).toBe(797.5);
    expect(pay.unpricedShifts).toBe(0);
  });

  it("leaves out shifts not worked", () => {
    const pay = priceSouthShifts({ DAY: 0, NIGHT: 2 }, { DAY: 80, NIGHT: 90 });
    expect(pay.lines.map((l) => l.shift)).toEqual(["NIGHT"]);
    expect(pay.amount).toBe(180);
  });

  it("pays nothing for shifts with no rate, and says how many", () => {
    const pay = priceSouthShifts({ DAY: 3, NIGHT: 2 }, { DAY: 80, NIGHT: null });
    expect(pay.amount).toBe(240);
    expect(pay.unpricedShifts).toBe(2);
    expect(pay.lines[1]).toMatchObject({ shift: "NIGHT", rate: null, amount: 0 });
  });
});

describe("southShiftRate", () => {
  const rates = [
    { officerId: null, service: "SOUTH_MOBILE_DAY_SHIFT", amount: "80.00" },
    { officerId: null, service: "SOUTH_MOBILE_NIGHT_SHIFT", amount: "95.00" },
    { officerId: "officer-a", service: "SOUTH_MOBILE_NIGHT_SHIFT", amount: "110.00" },
    { officerId: "officer-a", service: "PATROL", amount: "12.00" },
  ];

  it("uses the officer's own rate first", () => {
    expect(southShiftRate(rates, "officer-a", "NIGHT")).toBe(110);
  });

  it("falls back to the company default", () => {
    expect(southShiftRate(rates, "officer-a", "DAY")).toBe(80);
    expect(southShiftRate(rates, "officer-b", "NIGHT")).toBe(95);
  });

  it("is null when nothing is set", () => {
    expect(southShiftRate([], "officer-b", "DAY")).toBeNull();
  });
});

describe("countsInWindow", () => {
  const novFrom = parseIsoDate("2026-11-01")!;
  const novTo = parseIsoDate("2026-11-30", true)!;
  const later = new Date("2027-01-01T00:00:00Z");

  it("counts a night shift in the month it starts", () => {
    expect(countsInWindow("2026-11-30", "NIGHT", novFrom, novTo, later)).toBe(true);
    expect(countsInWindow("2026-10-31", "NIGHT", novFrom, novTo, later)).toBe(false);
  });

  it("leaves out shifts outside the window", () => {
    expect(countsInWindow("2026-12-01", "DAY", novFrom, novTo, later)).toBe(false);
  });

  it("leaves out shifts that haven't started yet", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    expect(countsInWindow("2026-11-24", "DAY", novFrom, novTo, now)).toBe(true);
    expect(countsInWindow("2026-11-24", "NIGHT", novFrom, novTo, now)).toBe(false);
  });

  it("keeps a summer month to its own days when the window ends at UTC midnight", () => {
    // A month picked as UTC days, as the payroll page's default window is:
    // 1 Jul 00:00 UTC to 31 Jul 23:59 UTC (00:59 UK on 1 Aug).
    const from = new Date("2026-07-01T00:00:00Z");
    const to = new Date("2026-07-31T23:59:59.999Z");
    expect(countsInWindow("2026-07-01", "DAY", from, to, later)).toBe(true);
    expect(countsInWindow("2026-07-31", "NIGHT", from, to, later)).toBe(true);
    expect(countsInWindow("2026-08-01", "DAY", from, to, later)).toBe(false);
  });
});
