import { describe, expect, it } from "vitest";
import {
  ROTA_SLOTS,
  addDays,
  availabilityFor,
  dateKey,
  dateValue,
  dayLabel,
  halvesOf,
  mondayOf,
  rotaSlot,
  shiftHours,
  shiftStartsAt,
  shiftsOverlap,
  slotName,
} from "./rota";

describe("rota shifts", () => {
  it("has North Mobile as one 24-hour shift and South Mobile as day + night", () => {
    expect(ROTA_SLOTS.map((s) => `${s.patrol}:${s.shift}`)).toEqual([
      "NORTH_MOBILE:FULL_DAY",
      "SOUTH_MOBILE:DAY",
      "SOUTH_MOBILE:NIGHT",
    ]);
  });

  it("knows which patrol has which shift", () => {
    expect(rotaSlot("SOUTH_MOBILE", "NIGHT")).not.toBeNull();
    expect(rotaSlot("NORTH_MOBILE", "DAY")).toBeNull();
    expect(rotaSlot("SOUTH_MOBILE", "FULL_DAY")).toBeNull();
    expect(rotaSlot("EAST_MOBILE", "DAY")).toBeNull();
  });

  it("shows the hours", () => {
    expect(shiftHours("DAY")).toBe("09:00–18:00");
    expect(shiftHours("NIGHT")).toBe("18:00–09:00 next day");
    expect(shiftHours("FULL_DAY")).toBe("09:00–09:00 next day");
    expect(slotName("SOUTH_MOBILE", "NIGHT")).toBe("South Mobile, night shift");
    expect(slotName("NORTH_MOBILE", "FULL_DAY")).toBe("North Mobile, 24 hours");
  });

  it("says which availability halves a shift takes", () => {
    expect(halvesOf("FULL_DAY")).toEqual(["DAY", "NIGHT"]);
    expect(halvesOf("NIGHT")).toEqual(["NIGHT"]);
  });
});

describe("shiftsOverlap", () => {
  const d = "2026-11-24";

  it("the North 24 hours overlap both South shifts the same day", () => {
    expect(shiftsOverlap({ date: d, shift: "FULL_DAY" }, { date: d, shift: "DAY" })).toBe(true);
    expect(shiftsOverlap({ date: d, shift: "FULL_DAY" }, { date: d, shift: "NIGHT" })).toBe(true);
    expect(shiftsOverlap({ date: d, shift: "NIGHT" }, { date: d, shift: "FULL_DAY" })).toBe(true);
  });

  it("South day and night the same day don't overlap", () => {
    expect(shiftsOverlap({ date: d, shift: "DAY" }, { date: d, shift: "NIGHT" })).toBe(false);
  });

  it("back-to-back shifts across 09:00 don't overlap", () => {
    // Night on the 23rd ends 09:00 on the 24th, as the North shift starts.
    expect(shiftsOverlap({ date: "2026-11-23", shift: "NIGHT" }, { date: d, shift: "FULL_DAY" })).toBe(false);
    // North on the 23rd ends 09:00 on the 24th, as the South day starts.
    expect(shiftsOverlap({ date: "2026-11-23", shift: "FULL_DAY" }, { date: d, shift: "DAY" })).toBe(false);
    // Two North shifts in a row.
    expect(shiftsOverlap({ date: "2026-11-23", shift: "FULL_DAY" }, { date: d, shift: "FULL_DAY" })).toBe(false);
  });

  it("the same shift overlaps itself, and shifts days apart don't", () => {
    expect(shiftsOverlap({ date: d, shift: "DAY" }, { date: d, shift: "DAY" })).toBe(true);
    expect(shiftsOverlap({ date: d, shift: "NIGHT" }, { date: "2026-11-26", shift: "NIGHT" })).toBe(false);
  });

  it("works across a month end", () => {
    expect(shiftsOverlap({ date: "2026-11-30", shift: "NIGHT" }, { date: "2026-12-01", shift: "DAY" })).toBe(false);
    expect(shiftsOverlap({ date: "2026-11-30", shift: "FULL_DAY" }, { date: "2026-11-30", shift: "NIGHT" })).toBe(true);
  });
});

describe("availabilityFor", () => {
  const north = rotaSlot("NORTH_MOBILE", "FULL_DAY")!;
  const southNight = rotaSlot("SOUTH_MOBILE", "NIGHT")!;

  it("needs both halves for the North 24 hours", () => {
    expect(availabilityFor(north, ["DAY", "NIGHT"])).toBe("full");
    expect(availabilityFor(north, ["DAY"])).toBe("partial");
    expect(availabilityFor(north, [])).toBe("none");
  });

  it("needs the matching half for a South shift", () => {
    expect(availabilityFor(southNight, ["NIGHT"])).toBe("full");
    expect(availabilityFor(southNight, new Set(["DAY"] as const))).toBe("none");
  });
});

describe("rota dates", () => {
  it("round-trips DATE values", () => {
    expect(dateKey(dateValue("2026-11-24"))).toBe("2026-11-24");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("finds the Monday", () => {
    expect(mondayOf("2026-11-23")).toBe("2026-11-23"); // a Monday
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(mondayOf("2026-12-02")).toBe("2026-11-30");
  });

  it("labels a day", () => {
    expect(dayLabel("2026-11-24")).toBe("Tue 24 Nov");
  });

  it("starts shifts on UK time, summer and winter", () => {
    // Winter (GMT): 09:00 UK = 09:00 UTC.
    expect(shiftStartsAt("2026-11-24", "DAY").toISOString()).toBe("2026-11-24T09:00:00.000Z");
    expect(shiftStartsAt("2026-11-24", "NIGHT").toISOString()).toBe("2026-11-24T18:00:00.000Z");
    // Summer (BST): 09:00 UK = 08:00 UTC.
    expect(shiftStartsAt("2026-07-01", "FULL_DAY").toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
});
