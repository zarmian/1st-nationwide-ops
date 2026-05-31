import { describe, expect, it } from "vitest";
import {
  daysFromTodayUk,
  formatDate,
  formatDateTime,
  formatTimeAgo,
  parseIsoDate,
  toIsoDate,
  ukDayPlus,
  ukDayString,
  ukWallClockToUtc,
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

describe("UK-aware day helpers", () => {
  it("ukDayString reads the Europe/London calendar day", () => {
    // 22:30 UTC on 31 May 2026 = 23:30 BST 31 May (BST is UTC+1 in summer)
    const inUkSameDay = new Date("2026-05-31T22:30:00Z");
    expect(ukDayString(inUkSameDay)).toBe("2026-05-31");

    // 23:30 UTC on 31 May 2026 = 00:30 BST 1 June — UK has rolled over
    const justAfterUkMidnight = new Date("2026-05-31T23:30:00Z");
    expect(ukDayString(justAfterUkMidnight)).toBe("2026-06-01");

    // Winter — Europe/London is UTC+0
    const winter = new Date("2026-01-15T23:30:00Z");
    expect(ukDayString(winter)).toBe("2026-01-15");
  });

  it("daysFromTodayUk compares UK calendar days, not UTC days", () => {
    const today = new Date("2026-05-31T12:00:00Z"); // mid-day, 31 May UK
    expect(daysFromTodayUk(new Date("2026-05-31T22:00:00Z"), today)).toBe(0);
    expect(daysFromTodayUk(new Date("2026-06-01T08:00:00Z"), today)).toBe(1);
    expect(daysFromTodayUk(new Date("2026-05-30T08:00:00Z"), today)).toBe(-1);

    // The historic bug: 23:30 BST on 31 May = 22:30 UTC. Server-local
    // midnight is UTC midnight, so the old logic put this on 30 May.
    // The new logic correctly says it's still today.
    const lateBst = new Date("2026-05-31T22:30:00Z");
    const nowEvening = new Date("2026-05-31T22:00:00Z");
    expect(daysFromTodayUk(lateBst, nowEvening)).toBe(0);
  });

  it("ukWallClockToUtc maps UK wall-clock to the right UTC instant", () => {
    // 08:00 UK on 31 May 2026 (BST = UTC+1) → 07:00 UTC
    const bst = ukWallClockToUtc(2026, 5, 31, 8, 0);
    expect(bst.toISOString()).toBe("2026-05-31T07:00:00.000Z");

    // 08:00 UK on 15 Jan 2026 (GMT = UTC+0) → 08:00 UTC
    const gmt = ukWallClockToUtc(2026, 1, 15, 8, 0);
    expect(gmt.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("ukDayPlus walks UK calendar days through DST transitions", () => {
    // 30 Mar 2025 BST starts (clocks jumped forward an hour overnight).
    // From 29 March 2025 noon UK, +1 day → 30 March 2025.
    const beforeDst = new Date("2025-03-29T12:00:00Z");
    expect(ukDayPlus(beforeDst, 1)).toEqual({
      year: 2025,
      month: 3,
      day: 30,
    });

    // From a winter day, +1 → next day (no DST).
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(ukDayPlus(winter, 1)).toEqual({
      year: 2026,
      month: 1,
      day: 16,
    });
  });
});
