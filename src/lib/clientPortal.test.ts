import { describe, it, expect } from "vitest";
import {
  summariseClientActivities,
  periodKey,
  periodLabel,
  periodKeysBetween,
} from "./clientPortal";

// Raw activity literals (structural match of the internal RawActivity type).
const mk = (
  kind: string,
  siteId: string,
  siteName: string,
  at: string,
  billed: number,
) => ({
  id: `${kind}:${at}`,
  kind,
  siteId,
  siteName,
  siteCode: null,
  at: new Date(at),
  status: "Completed" as const,
  billed,
});

describe("period helpers — month", () => {
  it("keys and labels a date in UK time", () => {
    expect(periodKey(new Date("2026-09-15T12:00:00Z"), "month")).toBe("2026-09");
    expect(periodLabel("2026-09", "month")).toBe("Sept 2026");
  });

  it("spans an inclusive month range", () => {
    expect(
      periodKeysBetween(
        new Date("2026-07-10T12:00:00Z"),
        new Date("2026-10-02T12:00:00Z"),
        "month",
      ),
    ).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("handles a year boundary", () => {
    expect(
      periodKeysBetween(
        new Date("2026-11-01T12:00:00Z"),
        new Date("2027-01-01T12:00:00Z"),
        "month",
      ),
    ).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("period helpers — week", () => {
  it("keys a date to the Monday of its UK week", () => {
    expect(periodKey(new Date("2026-09-15T12:00:00Z"), "week")).toBe(
      "2026-09-14",
    ); // Tue → Mon 14th
    expect(periodKey(new Date("2026-09-14T12:00:00Z"), "week")).toBe(
      "2026-09-14",
    ); // Mon → itself
    expect(periodKey(new Date("2026-09-20T12:00:00Z"), "week")).toBe(
      "2026-09-14",
    ); // Sun → Mon 14th
  });

  it("steps a week range by Mondays", () => {
    expect(
      periodKeysBetween(
        new Date("2026-09-01T12:00:00Z"),
        new Date("2026-09-20T12:00:00Z"),
        "week",
      ),
    ).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
  });
});

describe("summariseClientActivities", () => {
  const months = ["2026-08", "2026-09"];
  const rows = [
    mk("Patrol", "s1", "Alpha House", "2026-08-05T12:00:00Z", 40),
    mk("Patrol", "s1", "Alpha House", "2026-09-05T12:00:00Z", 40),
    mk("Alarm response", "s2", "Beta Depot", "2026-09-06T12:00:00Z", 120),
    mk("Lock-up", "s1", "Alpha House", "2026-09-07T12:00:00Z", 20),
  ];

  it("totals activities and spend", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.totalActivities).toBe(4);
    expect(s.totalSpend).toBe(220);
  });

  it("counts by kind, most frequent first", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.byKind[0]).toEqual({ label: "Patrol", count: 2 });
    expect(s.byKind.map((k) => k.label)).toContain("Alarm response");
  });

  it("sums spend per site, highest first", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.spendBySite[0]).toEqual({
      siteId: "s2",
      siteName: "Beta Depot",
      amount: 120,
    });
    expect(s.spendBySite[1].amount).toBe(100);
  });

  it("buckets activity + spend by period, zero-filling the range", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.activityByPeriod).toEqual([
      { key: "2026-08", label: "Aug 2026", count: 1 },
      { key: "2026-09", label: "Sept 2026", count: 3 },
    ]);
    expect(s.spendByPeriod.map((m) => m.amount)).toEqual([40, 180]);
  });

  it("buckets by week when asked", () => {
    const weekKeys = ["2026-08-31", "2026-09-07"];
    const weekRows = [
      mk("Patrol", "s1", "Alpha", "2026-09-01T12:00:00Z", 10), // wk 08-31
      mk("Patrol", "s1", "Alpha", "2026-09-08T12:00:00Z", 10), // wk 09-07
      mk("Patrol", "s1", "Alpha", "2026-09-09T12:00:00Z", 10), // wk 09-07
    ];
    const s = summariseClientActivities(weekRows, weekKeys, "week");
    expect(s.activityByPeriod.map((p) => p.count)).toEqual([1, 2]);
  });

  it("zero-fills periods with no activity", () => {
    const s = summariseClientActivities([], ["2026-09"], "month");
    expect(s.totalActivities).toBe(0);
    expect(s.spendByPeriod).toEqual([
      { key: "2026-09", label: "Sept 2026", amount: 0 },
    ]);
  });
});
