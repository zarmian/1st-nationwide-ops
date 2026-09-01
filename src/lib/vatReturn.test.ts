import { describe, it, expect } from "vitest";
import { calendarQuarter, recentQuarters, currentQuarter } from "./vatReturn";

describe("calendarQuarter", () => {
  it("spans the right months, start-of-day to end-of-day", () => {
    const q1 = calendarQuarter(2026, 1);
    expect(q1.label).toBe("Jan–Mar 2026");
    expect(q1.from.getFullYear()).toBe(2026);
    expect(q1.from.getMonth()).toBe(0); // Jan
    expect(q1.from.getDate()).toBe(1);
    expect(q1.to.getMonth()).toBe(2); // Mar
    expect(q1.to.getDate()).toBe(31);
    expect(q1.to.getHours()).toBe(23);
  });

  it("handles Q4 ending on 31 Dec", () => {
    const q4 = calendarQuarter(2026, 4);
    expect(q4.label).toBe("Oct–Dec 2026");
    expect(q4.to.getMonth()).toBe(11);
    expect(q4.to.getDate()).toBe(31);
  });

  it("handles the Feb quarter-end in a non-leap year", () => {
    const q1 = calendarQuarter(2025, 1);
    expect(q1.to.getMonth()).toBe(2); // still ends in March
    expect(q1.to.getDate()).toBe(31);
  });
});

describe("currentQuarter / recentQuarters", () => {
  it("puts a mid-May date in Apr–Jun", () => {
    const q = currentQuarter(new Date(2026, 4, 15));
    expect(q.label).toBe("Apr–Jun 2026");
  });

  it("walks backwards across a year boundary, newest first", () => {
    const qs = recentQuarters(new Date(2026, 1, 10), 3); // Feb 2026 → Q1
    expect(qs.map((q) => q.label)).toEqual([
      "Jan–Mar 2026",
      "Oct–Dec 2025",
      "Jul–Sep 2025",
    ]);
  });
});
