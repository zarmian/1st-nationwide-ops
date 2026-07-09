import { describe, expect, it } from "vitest";
import {
  defaultScheduledAt,
  evaluateSchedule,
  normalisePatrolTimes,
  resolvePatrolSlots,
  shouldCreateVisitOn,
} from "./patrolDates";
import { ukWallClockToUtc } from "./dates";

function schedule(overrides: Partial<Parameters<typeof evaluateSchedule>[0]> = {}) {
  return {
    dayOfWeek: "TUE",
    frequency: "WEEKLY",
    startsOn: null,
    endsOn: null,
    createdAt: new Date("2026-06-02T12:00:00Z"),
    intervalWeeks: null,
    exceptionDates: [],
    ...overrides,
  };
}

const TUE = new Date("2026-06-02T12:00:00Z"); // Tuesday
const WED = new Date("2026-06-03T12:00:00Z");

describe("evaluateSchedule — day-of-week", () => {
  it("matches when day-of-week aligns", () => {
    expect(evaluateSchedule(schedule(), TUE).ok).toBe(true);
  });

  it("skips with a reason when day-of-week differs", () => {
    const r = evaluateSchedule(schedule(), WED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/day-of-week/);
  });
});

describe("evaluateSchedule — frequency rules", () => {
  it("WEEKLY always matches the day-of-week", () => {
    expect(evaluateSchedule(schedule({ frequency: "WEEKLY" }), TUE).ok).toBe(true);
  });

  it("FORTNIGHTLY anchored on createdAt = matching day → week 0 hits", () => {
    // createdAt is Tue 2026-06-02 (the target). Week 0 → matches.
    expect(
      evaluateSchedule(
        schedule({ frequency: "FORTNIGHTLY", createdAt: TUE }),
        TUE,
      ).ok,
    ).toBe(true);
  });

  it("FORTNIGHTLY anchored on createdAt → week 1 skips", () => {
    const r = evaluateSchedule(
      schedule({ frequency: "FORTNIGHTLY", createdAt: TUE }),
      new Date("2026-06-09T12:00:00Z"), // next Tuesday
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/parity/);
  });

  it("FORTNIGHTLY week 2 hits", () => {
    expect(
      evaluateSchedule(
        schedule({ frequency: "FORTNIGHTLY", createdAt: TUE }),
        new Date("2026-06-16T12:00:00Z"), // 2 weeks later
      ).ok,
    ).toBe(true);
  });

  it("intervalWeeks overrides frequency", () => {
    // Every 3 weeks: week 0 hits, week 1+2 skip, week 3 hits.
    const s = schedule({
      frequency: "WEEKLY", // would otherwise always match
      intervalWeeks: 3,
      createdAt: TUE,
    });
    expect(evaluateSchedule(s, TUE).ok).toBe(true);
    expect(
      evaluateSchedule(s, new Date("2026-06-09T12:00:00Z")).ok,
    ).toBe(false);
    expect(
      evaluateSchedule(s, new Date("2026-06-23T12:00:00Z")).ok,
    ).toBe(true);
  });

  it("MONTHLY hits in the first calendar week only", () => {
    expect(
      evaluateSchedule(
        schedule({ frequency: "MONTHLY" }),
        new Date("2026-06-02T12:00:00Z"), // Tue 2nd
      ).ok,
    ).toBe(true);
    expect(
      evaluateSchedule(
        schedule({ frequency: "MONTHLY" }),
        new Date("2026-06-09T12:00:00Z"), // Tue 9th — out of range
      ).ok,
    ).toBe(false);
  });
});

describe("evaluateSchedule — bounds", () => {
  it("skips before startsOn", () => {
    const r = evaluateSchedule(
      schedule({ startsOn: new Date("2026-07-01T00:00:00Z") }),
      TUE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/starts-on/);
  });

  it("skips after endsOn", () => {
    const r = evaluateSchedule(
      schedule({ endsOn: new Date("2026-05-30T23:59:59Z") }),
      TUE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/end date/);
  });

  it("skips when today is in the exception list", () => {
    const r = evaluateSchedule(
      schedule({ exceptionDates: ["2026-06-02"] }),
      TUE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/skip list/);
  });
});

describe("shouldCreateVisitOn — boolean wrapper", () => {
  it("returns true / false matching evaluateSchedule.ok", () => {
    expect(shouldCreateVisitOn(schedule(), TUE)).toBe(true);
    expect(shouldCreateVisitOn(schedule(), WED)).toBe(false);
  });
});

describe("defaultScheduledAt — UK wall-clock", () => {
  it("uses 09:00 UK for VPI by default", () => {
    // 2 Jun 2026 = BST = UTC+1, so 09:00 UK → 08:00 UTC.
    expect(defaultScheduledAt(TUE, "VPI").toISOString()).toBe(
      "2026-06-02T08:00:00.000Z",
    );
  });

  it("uses 22:00 UK for patrols by default", () => {
    expect(defaultScheduledAt(TUE, "PATROL").toISOString()).toBe(
      "2026-06-02T21:00:00.000Z",
    );
  });

  it("honours per-schedule timeOfDay (UK wall-clock)", () => {
    // 05:45 UK BST → 04:45 UTC
    expect(defaultScheduledAt(TUE, "VPI", "05:45").toISOString()).toBe(
      "2026-06-02T04:45:00.000Z",
    );
  });

  it("falls back to kind default for malformed timeOfDay", () => {
    expect(defaultScheduledAt(TUE, "VPI", "nope").toISOString()).toBe(
      "2026-06-02T08:00:00.000Z",
    );
  });
});

describe("normalisePatrolTimes", () => {
  it("keeps a valid times list", () => {
    expect(normalisePatrolTimes(["22:00", "01:00"], null, "PATROL")).toEqual([
      "22:00",
      "01:00",
    ]);
  });
  it("falls back to the single timeOfDay when list is empty", () => {
    expect(normalisePatrolTimes([], "08:30", "PATROL")).toEqual(["08:30"]);
  });
  it("falls back to the kind default when nothing is set", () => {
    expect(normalisePatrolTimes([], null, "PATROL")).toEqual(["22:00"]);
    expect(normalisePatrolTimes(null, null, "VPI")).toEqual(["09:00"]);
  });
  it("drops malformed entries", () => {
    expect(normalisePatrolTimes(["09:00", "nope", "17:00"], null, "PATROL")).toEqual([
      "09:00",
      "17:00",
    ]);
  });
});

describe("resolvePatrolSlots", () => {
  const FRI = new Date("2026-06-05T12:00:00Z"); // Friday, BST

  it("expands a daytime list to same-day slots in order", () => {
    const slots = resolvePatrolSlots(FRI, "PATROL", ["09:00", "13:00", "17:00"]);
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      ukWallClockToUtc(2026, 6, 5, 9, 0).toISOString(),
      ukWallClockToUtc(2026, 6, 5, 13, 0).toISOString(),
      ukWallClockToUtc(2026, 6, 5, 17, 0).toISOString(),
    ]);
    // all grouped under Friday
    const night = ukWallClockToUtc(2026, 6, 5, 0, 0).toISOString();
    expect(slots.every((s) => s.scheduleDate.toISOString() === night)).toBe(true);
  });

  it("rolls post-midnight patrols to the next day but groups under the night started", () => {
    const slots = resolvePatrolSlots(FRI, "PATROL", ["22:00", "01:00", "04:00"]);
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      ukWallClockToUtc(2026, 6, 5, 22, 0).toISOString(), // Fri 22:00
      ukWallClockToUtc(2026, 6, 6, 1, 0).toISOString(), // Sat 01:00
      ukWallClockToUtc(2026, 6, 6, 4, 0).toISOString(), // Sat 04:00
    ]);
    // spacing is a clean 3h each (proves the roll, not a 21h backwards jump)
    const t = slots.map((s) => s.scheduledAt.getTime());
    expect(t[1] - t[0]).toBe(3 * 3600_000);
    expect(t[2] - t[1]).toBe(3 * 3600_000);
    // every slot grouped under Friday night
    const night = ukWallClockToUtc(2026, 6, 5, 0, 0).toISOString();
    expect(slots.every((s) => s.scheduleDate.toISOString() === night)).toBe(true);
  });

  it("handles a month-boundary overnight roll", () => {
    const JUN30 = new Date("2026-06-30T12:00:00Z");
    const slots = resolvePatrolSlots(JUN30, "PATROL", ["23:00", "02:00"]);
    expect(slots[1].scheduledAt.toISOString()).toBe(
      ukWallClockToUtc(2026, 7, 1, 2, 0).toISOString(),
    );
  });

  it("falls back to a single default slot when no times set", () => {
    const slots = resolvePatrolSlots(FRI, "PATROL", []);
    expect(slots).toHaveLength(1);
    expect(slots[0].scheduledAt.toISOString()).toBe(
      ukWallClockToUtc(2026, 6, 5, 22, 0).toISOString(),
    );
  });
});
