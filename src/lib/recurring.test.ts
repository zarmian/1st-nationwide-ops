import { describe, it, expect } from "vitest";
import { periodsDue } from "./recurring";

type Charge = Parameters<typeof periodsDue>[0];

const charge = (over: Partial<Charge>): Charge =>
  ({
    id: "c",
    description: "d",
    service: null,
    amount: 10,
    cadence: "MONTHLY",
    startDate: new Date(2026, 0, 1),
    endDate: null,
    ...over,
  }) as Charge;

const keys = (c: Charge, from: Date, to: Date) =>
  periodsDue(c, from, to).map((p) => p.periodKey);

describe("periodsDue", () => {
  it("monthly: one key per month in the window", () => {
    expect(
      keys(charge({}), new Date(2026, 7, 1), new Date(2026, 7, 31)),
    ).toEqual(["2026-08"]);
  });

  it("monthly across a quarter → three", () => {
    expect(
      keys(charge({}), new Date(2026, 6, 1), new Date(2026, 8, 30)),
    ).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("respects the start date", () => {
    expect(
      keys(
        charge({ startDate: new Date(2026, 7, 15) }),
        new Date(2026, 6, 1),
        new Date(2026, 8, 30),
      ),
    ).toEqual(["2026-08", "2026-09"]);
  });

  it("respects the end date", () => {
    expect(
      keys(
        charge({ endDate: new Date(2026, 7, 10) }),
        new Date(2026, 6, 1),
        new Date(2026, 8, 30),
      ),
    ).toEqual(["2026-07", "2026-08"]);
  });

  it("annual: only the anniversary month, once a year", () => {
    expect(
      keys(
        charge({ cadence: "ANNUAL", startDate: new Date(2026, 2, 1) }),
        new Date(2026, 0, 1),
        new Date(2026, 11, 31),
      ),
    ).toEqual(["2026"]);
  });

  it("quarterly: calendar-quarter starts", () => {
    expect(
      keys(
        charge({ cadence: "QUARTERLY" }),
        new Date(2026, 0, 1),
        new Date(2026, 11, 31),
      ),
    ).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  });

  it("one-off: the month containing the start date, once", () => {
    expect(
      keys(
        charge({ cadence: "ONE_OFF", startDate: new Date(2026, 7, 20) }),
        new Date(2026, 6, 1),
        new Date(2026, 8, 30),
      ),
    ).toEqual(["ONEOFF"]);
  });
});
