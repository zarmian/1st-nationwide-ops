import { describe, expect, it } from "vitest";
import {
  computeCheckSlots,
  openSlotAt,
  nextSlotAfter,
  missedSlots,
} from "./shiftChecks";

// 22:00 → 02:00 (4h), hourly checks, 15-min grace.
const START = new Date("2026-07-10T21:00:00Z"); // 22:00 BST
const END = new Date("2026-07-11T01:00:00Z"); // 02:00 BST

function slots() {
  return computeCheckSlots({
    startBasis: START,
    endBasis: END,
    intervalMin: 60,
    graceMin: 15,
  });
}

describe("computeCheckSlots", () => {
  it("creates one slot per interval, strictly before the end", () => {
    const s = slots();
    // due at 23:00, 00:00, 01:00 (02:00 is the end → excluded)
    expect(s.map((x) => x.dueAt.toISOString())).toEqual([
      "2026-07-10T22:00:00.000Z",
      "2026-07-10T23:00:00.000Z",
      "2026-07-11T00:00:00.000Z",
    ]);
    expect(s.map((x) => x.index)).toEqual([1, 2, 3]);
  });

  it("opens 10 min before due and closes after the grace buffer", () => {
    const first = slots()[0];
    expect(first.opensAt.toISOString()).toBe("2026-07-10T21:50:00.000Z"); // 22:50 - 10
    expect(first.closesAt.toISOString()).toBe("2026-07-10T22:15:00.000Z"); // 23:00 + 15
  });

  it("returns no slots for a shift shorter than one interval", () => {
    expect(
      computeCheckSlots({
        startBasis: START,
        endBasis: new Date(START.getTime() + 30 * 60_000),
        intervalMin: 60,
        graceMin: 15,
      }),
    ).toHaveLength(0);
  });
});

describe("openSlotAt", () => {
  const s = slots();
  it("is closed before the window opens", () => {
    expect(openSlotAt(s, new Date("2026-07-10T21:49:00Z"))).toBeNull();
  });
  it("is open from 10 min before due", () => {
    expect(openSlotAt(s, new Date("2026-07-10T21:50:00Z"))?.index).toBe(1);
    expect(openSlotAt(s, new Date("2026-07-10T22:00:00Z"))?.index).toBe(1); // at due
    expect(openSlotAt(s, new Date("2026-07-10T22:15:00Z"))?.index).toBe(1); // grace edge
  });
  it("is closed once the grace buffer passes", () => {
    expect(openSlotAt(s, new Date("2026-07-10T22:16:00Z"))).toBeNull();
  });
});

describe("nextSlotAfter", () => {
  const s = slots();
  it("points at the upcoming slot when between windows", () => {
    expect(nextSlotAfter(s, new Date("2026-07-10T22:30:00Z"))?.index).toBe(2);
  });
  it("is null after the last slot opens", () => {
    expect(nextSlotAfter(s, new Date("2026-07-11T00:00:00Z"))).toBeNull();
  });
});

describe("missedSlots", () => {
  const s = slots();
  it("flags closed slots with no check-in", () => {
    // After 22:16, slot 1's window has closed. Not done → missed.
    const missed = missedSlots(s, new Set<number>(), new Date("2026-07-10T22:20:00Z"));
    expect(missed.map((x) => x.index)).toEqual([1]);
  });
  it("does not flag a slot that was checked in", () => {
    const missed = missedSlots(s, new Set([1]), new Date("2026-07-10T22:20:00Z"));
    expect(missed).toHaveLength(0);
  });
});
