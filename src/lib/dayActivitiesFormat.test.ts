import { describe, expect, it } from "vitest";
import {
  formatDayActivitiesMessage,
  formatNowMessage,
  resolveDayTarget,
  type DayActivity,
} from "./dayActivitiesFormat";

// Fixed "now": 25 Jul 2026, 12:00 UTC (13:00 BST) — safely mid-day in the UK.
const NOW = new Date("2026-07-25T12:00:00Z");

describe("resolveDayTarget", () => {
  it("resolves today", () => {
    const t = resolveDayTarget("today", NOW);
    expect(t).toMatchObject({ year: 2026, month: 7, day: 25 });
    expect(t?.label).toContain("Jul");
  });

  it("resolves yesterday and tomorrow", () => {
    expect(resolveDayTarget("yesterday", NOW)).toMatchObject({ day: 24 });
    expect(resolveDayTarget("tomorrow", NOW)).toMatchObject({ day: 26 });
  });

  it("treats an empty string as today", () => {
    expect(resolveDayTarget("", NOW)).toMatchObject({ day: 25 });
  });

  it("accepts an explicit ISO date", () => {
    expect(resolveDayTarget("2026-01-15", NOW)).toMatchObject({
      year: 2026,
      month: 1,
      day: 15,
    });
  });

  it("accepts day-first numeric dates (UK order)", () => {
    expect(resolveDayTarget("3/8", NOW)).toMatchObject({
      year: 2026,
      month: 8,
      day: 3,
    });
    expect(resolveDayTarget("03-08-2025", NOW)).toMatchObject({
      year: 2025,
      month: 8,
      day: 3,
    });
    expect(resolveDayTarget("3.8.25", NOW)).toMatchObject({
      year: 2025,
      month: 8,
      day: 3,
    });
  });

  it("accepts spoken dates with month names and ordinals", () => {
    expect(resolveDayTarget("3 August", NOW)).toMatchObject({
      year: 2026,
      month: 8,
      day: 3,
    });
    expect(resolveDayTarget("3rd Aug 2025", NOW)).toMatchObject({
      year: 2025,
      month: 8,
      day: 3,
    });
    expect(resolveDayTarget("August 3", NOW)).toMatchObject({
      year: 2026,
      month: 8,
      day: 3,
    });
  });

  it("rejects impossible dates", () => {
    expect(resolveDayTarget("31 February", NOW)).toBeNull();
    expect(resolveDayTarget("2026-13-01", NOW)).toBeNull();
    expect(resolveDayTarget("45/8", NOW)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveDayTarget("YESTERDAY", NOW)).toMatchObject({ day: 24 });
  });

  it("returns null for anything else", () => {
    expect(resolveDayTarget("next week", NOW)).toBeNull();
    expect(resolveDayTarget("banana", NOW)).toBeNull();
  });
});

describe("formatDayActivitiesMessage", () => {
  const row = (over: Partial<DayActivity> = {}): DayActivity => ({
    at: new Date("2026-07-25T08:30:00Z"), // 09:30 BST
    endsAt: null,
    kindLabel: "Alarm response",
    siteName: "Shurgard Neasden",
    who: "John Smith",
    status: "ASSIGNED",
    source: "JOB",
    ...over,
  });

  it("shows an empty-day message", () => {
    const msg = formatDayActivitiesMessage([], "Friday 25 Jul 2026");
    expect(msg).toContain("Friday 25 Jul 2026");
    expect(msg).toContain("Nothing scheduled");
  });

  it("renders a row with UK time, kind, site and who", () => {
    const msg = formatDayActivitiesMessage([row()], "Friday 25 Jul 2026");
    expect(msg).toContain("09:30");
    expect(msg).toContain("Alarm response");
    expect(msg).toContain("Shurgard Neasden");
    expect(msg).toContain("John Smith");
    expect(msg).toContain("1 activity");
  });

  it("renders a shift as a start–end range", () => {
    const msg = formatDayActivitiesMessage(
      [
        row({
          source: "SHIFT",
          kindLabel: "Static guarding",
          at: new Date("2026-07-25T21:00:00Z"), // 22:00 BST
          endsAt: new Date("2026-07-26T05:00:00Z"), // 06:00 BST
          who: "Nexus Security (partner)",
          status: "PENDING",
        }),
      ],
      "Friday 25 Jul 2026",
    );
    expect(msg).toContain("22:00–06:00");
    expect(msg).toContain("Static guarding");
    expect(msg).toContain("Nexus Security (partner)");
  });

  it("escapes HTML in site names and who", () => {
    const msg = formatDayActivitiesMessage(
      [row({ siteName: "A & B <yard>", who: "O'Neil <x>" })],
      "Day",
    );
    expect(msg).toContain("A &amp; B &lt;yard&gt;");
    expect(msg).not.toContain("<yard>");
  });

  it("caps a very long day and notes the remainder", () => {
    const rows = Array.from({ length: 45 }, () => row());
    const msg = formatDayActivitiesMessage(rows, "Busy day");
    expect(msg).toContain("45 activities");
    expect(msg).toContain("…and 5 more");
  });

  it("adds the site note when filtered", () => {
    const msg = formatDayActivitiesMessage(
      [row()],
      "Friday 25 Jul 2026",
      "at Shurgard Neasden",
    );
    expect(msg).toContain("at Shurgard Neasden");
  });
});

describe("formatNowMessage", () => {
  const row = (over: Partial<DayActivity> = {}): DayActivity => ({
    at: new Date("2026-07-25T08:30:00Z"),
    endsAt: null,
    kindLabel: "Alarm response",
    siteName: "Shurgard Neasden",
    who: "John Smith",
    status: "IN_PROGRESS",
    source: "JOB",
    ...over,
  });

  it("says all quiet when nothing is active or overdue", () => {
    const msg = formatNowMessage([], [], "Sat 26 Jul, 22:31");
    expect(msg).toContain("On now");
    expect(msg).toContain("All quiet");
  });

  it("shows in-progress and overdue sections with counts", () => {
    const msg = formatNowMessage(
      [row()],
      [row({ kindLabel: "Lock-up", siteName: "Shurgard Norbury", status: "ASSIGNED" })],
      "Sat 26 Jul, 22:31",
    );
    expect(msg).toContain("In progress (1)");
    expect(msg).toContain("Overdue / not started (1)");
    expect(msg).toContain("Shurgard Neasden");
    expect(msg).toContain("Shurgard Norbury");
  });

  it("omits the overdue section when there's nothing overdue", () => {
    const msg = formatNowMessage([row()], [], "Sat 26 Jul, 22:31");
    expect(msg).toContain("In progress (1)");
    expect(msg).not.toContain("Overdue");
  });
});
