import { describe, expect, it } from "vitest";
import {
  ToolInputError,
  resolveDayRange,
  statusGroupOf,
  statusesFor,
  ukIso,
} from "./common";

describe("ukIso", () => {
  it("shows UK local time with the right offset in summer and winter", () => {
    expect(ukIso(new Date("2026-07-01T18:30:00Z"))).toBe("2026-07-01T19:30+01:00");
    expect(ukIso(new Date("2026-12-01T18:30:00Z"))).toBe("2026-12-01T18:30+00:00");
    expect(ukIso(new Date("2026-06-30T23:15:00Z"))).toBe("2026-07-01T00:15+01:00");
    expect(ukIso(null)).toBeNull();
  });
});

describe("resolveDayRange", () => {
  const defaults = { from: "2026-10-01", to: "2026-10-11" };
  it("uses UK day boundaries and sensible defaults", () => {
    const r = resolveDayRange({}, defaults, 31);
    expect(r.from).toBe("2026-10-01");
    expect(r.fromDate.toISOString()).toBe("2026-09-30T23:00:00.000Z"); // 00:00 BST
    const single = resolveDayRange({ from: "2026-12-05" }, defaults, 31);
    expect(single.to).toBe("2026-12-05");
    expect(single.toDate.toISOString()).toBe("2026-12-05T23:59:59.999Z"); // GMT
  });
  it("rejects bad, reversed and over-long windows with a readable message", () => {
    expect(() => resolveDayRange({ from: "11/10/2026" }, defaults, 31)).toThrow(ToolInputError);
    expect(() => resolveDayRange({ from: "2026-13-45" }, defaults, 31)).toThrow(/date like/);
    expect(() => resolveDayRange({ from: "2026-04-31" }, defaults, 31)).toThrow(/date like/);
    expect(() => resolveDayRange({ from: "2026-10-11", to: "2026-10-01" }, defaults, 31)).toThrow(/before/);
    expect(() => resolveDayRange({ from: "2026-01-01", to: "2026-10-01" }, defaults, 31)).toThrow(/at once is 31/);
  });
});

describe("status groups", () => {
  it("bucket statuses the way the Activities log does", () => {
    expect(statusGroupOf("OPEN")).toBe("scheduled");
    expect(statusGroupOf("LATE")).toBe("in_progress");
    expect(statusGroupOf("APPROVED")).toBe("completed");
    expect(statusGroupOf("ABANDONED")).toBe("missed");
    expect(statusGroupOf("CANCELLED")).toBe("cancelled");
    expect(statusesFor(undefined, ["OPEN"])).toBeNull();
    expect(statusesFor(["missed"], ["PENDING", "MISSED", "ABANDONED"])).toEqual(["MISSED", "ABANDONED"]);
  });
});
