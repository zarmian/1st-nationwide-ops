import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatTimeAgo,
  parseIsoDate,
  toIsoDate,
} from "./dates";

describe("formatDate / formatDateTime", () => {
  it("renders an em-dash for null / invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
  });

  it("renders en-GB short dates", () => {
    const d = new Date("2026-05-02T09:00:00Z");
    // Day + abbreviated month + 4-digit year; exact spacing depends on the
    // node ICU build, so just assert the parts.
    const out = formatDate(d);
    expect(out).toMatch(/02/);
    expect(out).toMatch(/May/);
    expect(out).toMatch(/2026/);
  });
});

describe("formatTimeAgo", () => {
  const now = new Date("2026-05-02T12:00:00Z");

  it("returns 'just now' under one minute", () => {
    expect(formatTimeAgo(new Date(now.getTime() - 30_000), now)).toBe("just now");
  });

  it("renders minutes / hours / days as appropriate", () => {
    expect(formatTimeAgo(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
    expect(formatTimeAgo(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3h ago");
    expect(formatTimeAgo(new Date(now.getTime() - 2 * 86_400_000), now)).toBe("2d ago");
  });

  it("drops to a date for anything older than ~6 days", () => {
    const old = new Date(now.getTime() - 10 * 86_400_000);
    expect(formatTimeAgo(old, now)).toMatch(/Apr/);
  });

  it("flips to 'in X' for future timestamps", () => {
    expect(formatTimeAgo(new Date(now.getTime() + 90_000), now)).toBe("in 2m");
  });

  it("em-dashes null / invalid input", () => {
    expect(formatTimeAgo(null, now)).toBe("—");
    expect(formatTimeAgo("nonsense", now)).toBe("—");
  });
});

describe("parseIsoDate / toIsoDate", () => {
  it("round-trips a valid YYYY-MM-DD", () => {
    const d = parseIsoDate("2026-05-02");
    expect(d).not.toBeNull();
    expect(toIsoDate(d)).toBe("2026-05-02");
  });

  it("returns null for malformed input", () => {
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate("2026/05/02")).toBeNull();
    expect(parseIsoDate("not a date")).toBeNull();
  });

  it("end-of-day option sets the time to 23:59:59.999", () => {
    const d = parseIsoDate("2026-05-02", true)!;
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
  });

  it("toIsoDate returns empty string for null", () => {
    expect(toIsoDate(null)).toBe("");
  });
});
