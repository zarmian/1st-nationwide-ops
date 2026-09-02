import { describe, it, expect } from "vitest";
import {
  summariseClientActivities,
  monthKeysBetween,
  ukMonthKey,
  ukMonthLabel,
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

describe("month helpers", () => {
  it("keys and labels a date in UK time", () => {
    expect(ukMonthKey(new Date("2026-09-15T12:00:00Z"))).toBe("2026-09");
    expect(ukMonthLabel("2026-09")).toBe("Sept 2026");
  });

  it("spans an inclusive month range", () => {
    const keys = monthKeysBetween(
      new Date("2026-07-10T12:00:00Z"),
      new Date("2026-10-02T12:00:00Z"),
    );
    expect(keys).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("handles a year boundary", () => {
    const keys = monthKeysBetween(
      new Date("2026-11-01T12:00:00Z"),
      new Date("2027-01-01T12:00:00Z"),
    );
    expect(keys).toEqual(["2026-11", "2026-12", "2027-01"]);
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
    const s = summariseClientActivities(rows, months);
    expect(s.totalActivities).toBe(4);
    expect(s.totalSpend).toBe(220);
  });

  it("counts by kind, most frequent first", () => {
    const s = summariseClientActivities(rows, months);
    expect(s.byKind[0]).toEqual({ label: "Patrol", count: 2 });
    expect(s.byKind.map((k) => k.label)).toContain("Alarm response");
  });

  it("sums spend per site, highest first", () => {
    const s = summariseClientActivities(rows, months);
    // Alpha: 40+40+20 = 100; Beta: 120 → Beta first.
    expect(s.spendBySite[0]).toEqual({
      siteId: "s2",
      siteName: "Beta Depot",
      amount: 120,
    });
    expect(s.spendBySite[1].amount).toBe(100);
  });

  it("buckets activity + spend by month, zero-filling the range", () => {
    const s = summariseClientActivities(rows, months);
    expect(s.activityByMonth).toEqual([
      { key: "2026-08", label: "Aug 2026", count: 1 },
      { key: "2026-09", label: "Sept 2026", count: 3 },
    ]);
    expect(s.spendByMonth.map((m) => m.amount)).toEqual([40, 180]);
  });

  it("zero-fills months with no activity", () => {
    const s = summariseClientActivities([], ["2026-09"]);
    expect(s.totalActivities).toBe(0);
    expect(s.spendByMonth).toEqual([
      { key: "2026-09", label: "Sept 2026", amount: 0 },
    ]);
  });
});
