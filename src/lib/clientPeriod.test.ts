import { describe, it, expect } from "vitest";
import {
  bucketParams,
  daysLabel,
  monthLabel,
  monthOptions,
  periodHref,
  resolvePeriod,
} from "./clientPeriod";

// Friday 23 October 2026, 14:30 BST.
const NOW = new Date("2026-10-23T13:30:00Z");

describe("resolvePeriod — presets", () => {
  it("defaults to the last 12 months, floored to when the data starts", () => {
    const p = resolvePeriod({}, NOW);
    expect(p.mode).toBe("preset");
    expect(p.key).toBe("months");
    expect(p.fromDay).toBe("2026-09-01");
    expect(p.toDay).toBe("2026-10-23");
    expect(p.from.toISOString()).toBe("2026-08-31T23:00:00.000Z"); // UK midnight, BST
    expect(p.to).toEqual(NOW);
    expect(p.bucket).toBe("month");
    expect(p.label).toBe("Last 12 months");
    expect(p.params).toEqual({ range: "months" });
  });

  it("starts the 12 months on the 1st, so every month bar is a whole month", () => {
    const p = resolvePeriod({ range: "months" }, new Date("2027-10-15T09:00:00Z"));
    expect(p.fromDay).toBe("2026-11-01");
    expect(p.from.toISOString()).toBe("2026-11-01T00:00:00.000Z"); // GMT
  });

  it("starts the 12 weeks on a Monday", () => {
    const p = resolvePeriod({ range: "weeks" }, new Date("2027-03-10T12:00:00Z")); // a Wednesday
    expect(p.fromDay).toBe("2026-12-21");
    expect(p.bucket).toBe("week");
  });

  it("gives today so far and the whole of yesterday", () => {
    const today = resolvePeriod({ range: "today" }, NOW);
    expect([today.fromDay, today.toDay, today.bucket]).toEqual(["2026-10-23", "2026-10-23", "day"]);
    expect(today.to).toEqual(NOW);
    const y = resolvePeriod({ range: "yesterday" }, NOW);
    expect([y.fromDay, y.toDay]).toEqual(["2026-10-22", "2026-10-22"]);
    expect(y.to.toISOString()).toBe("2026-10-22T22:59:59.999Z");
  });

  it("ignores an unknown preset", () => {
    expect(resolvePeriod({ range: "decade" }, NOW).key).toBe("months");
  });
});

describe("resolvePeriod — a month", () => {
  it("covers the whole UK month, by day", () => {
    const p = resolvePeriod({ month: "2026-09" }, NOW);
    expect(p.mode).toBe("month");
    expect(p.month).toBe("2026-09");
    expect([p.fromDay, p.toDay]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(p.from.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-09-30T22:59:59.999Z");
    expect(p.bucket).toBe("day");
    expect(p.label).toBe("September 2026");
    expect(p.params).toEqual({ month: "2026-09" });
  });

  it("stops this month at now", () => {
    const p = resolvePeriod({ month: "2026-10" }, NOW);
    expect(p.toDay).toBe("2026-10-23");
    expect(p.to).toEqual(NOW);
  });

  it("wins over a preset and dates in the same URL", () => {
    expect(resolvePeriod({ month: "2026-09", range: "today", from: "2026-10-01" }, NOW).mode).toBe(
      "month",
    );
  });

  it("falls back to the default for a month before the data, in the future or malformed", () => {
    for (const month of ["2026-08", "2026-11", "2026-13", "Sept", "2026-9"]) {
      expect(resolvePeriod({ month }, NOW).key).toBe("months");
    }
  });
});

describe("resolvePeriod — a run of days", () => {
  it("takes from/to as UK days, by day up to a month", () => {
    const p = resolvePeriod({ from: "2026-09-05", to: "2026-09-12" }, NOW);
    expect(p.mode).toBe("custom");
    expect([p.fromDay, p.toDay, p.bucket]).toEqual(["2026-09-05", "2026-09-12", "day"]);
    expect(p.label).toBe("5 – 12 Sept 2026");
    expect(p.params).toEqual({ from: "2026-09-05", to: "2026-09-12" });
  });

  it("buckets longer runs by week, then by month", () => {
    expect(resolvePeriod({ from: "2026-09-01", to: "2026-10-20" }, NOW).bucket).toBe("week");
    expect(
      resolvePeriod({ from: "2026-09-01", to: "2027-06-30" }, new Date("2027-07-01T12:00:00Z"))
        .bucket,
    ).toBe("month");
  });

  it("swaps a backwards range and keeps it inside the data and today", () => {
    const p = resolvePeriod({ from: "2026-10-30", to: "2026-08-01" }, NOW);
    expect([p.fromDay, p.toDay]).toEqual(["2026-09-01", "2026-10-23"]);
  });

  it("fills a missing end from the data floor or today", () => {
    expect(resolvePeriod({ from: "2026-10-01" }, NOW).toDay).toBe("2026-10-23");
    expect(resolvePeriod({ to: "2026-09-10" }, NOW).fromDay).toBe("2026-09-01");
  });

  it("ignores dates that don't exist", () => {
    expect(resolvePeriod({ from: "2026-09-31", to: "nope" }, NOW).mode).toBe("preset");
  });

  it("ends a day at the next UK midnight, on the clock-change day too", () => {
    // Clocks go back on Sunday 25 October 2026: that day is 25 hours long.
    const p = resolvePeriod({ from: "2026-10-25", to: "2026-10-25" }, new Date("2026-11-10T12:00:00Z"));
    expect(p.from.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-25T23:59:59.999Z");
    expect(p.label).toBe("Sun, 25 Oct 2026");
  });
});

describe("labels", () => {
  it("names months and runs of days", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(daysLabel("2026-09-10", "2026-10-20")).toBe("10 Sept – 20 Oct 2026");
    expect(daysLabel("2026-12-20", "2027-01-05")).toBe("20 Dec 2026 – 5 Jan 2027");
  });

  it("lists every month since the data starts, newest first", () => {
    expect(monthOptions(NOW)).toEqual([
      { key: "2026-10", label: "October 2026" },
      { key: "2026-09", label: "September 2026" },
    ]);
  });
});

describe("periodHref", () => {
  it("adds the filters that are set", () => {
    expect(periodHref("/client/activities", { month: "2026-09" }, { type: "callout", siteId: null })).toBe(
      "/client/activities?month=2026-09&type=callout",
    );
    expect(periodHref("/client", {})).toBe("/client");
  });
});

describe("bucketParams — what a chart bar opens", () => {
  it("opens a whole month as that month", () => {
    const p = resolvePeriod({ range: "months" }, NOW);
    expect(bucketParams(p, "2026-09")).toEqual({ month: "2026-09" });
    // This month so far is still just "this month".
    expect(bucketParams(p, "2026-10")).toEqual({ month: "2026-10" });
  });

  it("trims a month to the days on screen", () => {
    const p = resolvePeriod({ from: "2026-09-10", to: "2027-04-20" }, new Date("2027-05-01T12:00:00Z"));
    expect(p.bucket).toBe("month");
    expect(bucketParams(p, "2026-09")).toEqual({ from: "2026-09-10", to: "2026-09-30" });
    expect(bucketParams(p, "2026-10")).toEqual({ month: "2026-10" });
    expect(bucketParams(p, "2027-04")).toEqual({ from: "2027-04-01", to: "2027-04-20" });
  });

  it("opens a week Monday to Sunday, trimmed to the period", () => {
    const p = resolvePeriod({ range: "weeks" }, NOW);
    expect(bucketParams(p, "2026-08-31")).toEqual({ from: "2026-09-01", to: "2026-09-06" });
    expect(bucketParams(p, "2026-09-14")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(bucketParams(p, "2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-23" });
  });

  it("opens a day as that day", () => {
    const p = resolvePeriod({ month: "2026-09" }, NOW);
    expect(bucketParams(p, "2026-09-05")).toEqual({ from: "2026-09-05", to: "2026-09-05" });
  });
});
