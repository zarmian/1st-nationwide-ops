import { describe, expect, it } from "vitest";
import {
  defaultScheduledAt,
  evaluateSchedule,
  shouldCreateVisitOn,
} from "./patrolDates";

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
