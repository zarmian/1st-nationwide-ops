import { describe, it, expect } from "vitest";
import {
  computeAlarmSla,
  summariseAlarmSla,
  targetMinsFor,
  slaTimingLabel,
  DEFAULT_SLA_TARGET_MINS,
} from "./alarmSla";

const received = new Date("2026-09-02T10:00:00Z");
const mins = (n: number) => new Date(received.getTime() + n * 60000);

describe("targetMinsFor", () => {
  it("uses per-priority defaults", () => {
    expect(targetMinsFor("HIGH")).toBe(DEFAULT_SLA_TARGET_MINS.HIGH);
    expect(targetMinsFor("MEDIUM")).toBe(45);
    expect(targetMinsFor("LOW")).toBe(90);
  });
  it("honours a positive override", () => {
    expect(targetMinsFor("HIGH", 10)).toBe(10);
  });
  it("ignores a zero/negative override", () => {
    expect(targetMinsFor("HIGH", 0)).toBe(20);
    expect(targetMinsFor("HIGH", -5)).toBe(20);
  });
});

describe("computeAlarmSla — still responding", () => {
  it("is 'responding' early in the window", () => {
    const r = computeAlarmSla({
      receivedAt: received,
      arrivedAt: null,
      priority: "HIGH", // 20-min target
      now: mins(5),
    });
    expect(r.status).toBe("responding");
    expect(r.arrived).toBe(false);
    expect(r.remainingMins).toBe(15);
    expect(r.responseMins).toBeNull();
  });

  it("is 'at_risk' in the last fifth of the window", () => {
    const r = computeAlarmSla({
      receivedAt: received,
      arrivedAt: null,
      priority: "HIGH",
      now: mins(17), // 85% of 20
    });
    expect(r.status).toBe("at_risk");
    expect(r.remainingMins).toBe(3);
  });

  it("is 'breached' once the target passes with no arrival", () => {
    const r = computeAlarmSla({
      receivedAt: received,
      arrivedAt: null,
      priority: "HIGH",
      now: mins(26),
    });
    expect(r.status).toBe("breached");
    expect(r.remainingMins).toBe(-6);
    expect(slaTimingLabel(r)).toBe("6m over");
  });
});

describe("computeAlarmSla — arrived", () => {
  it("is 'met' when on site within target", () => {
    const r = computeAlarmSla({
      receivedAt: received,
      arrivedAt: mins(12),
      priority: "HIGH",
    });
    expect(r.status).toBe("met");
    expect(r.arrived).toBe(true);
    expect(r.responseMins).toBe(12);
    expect(slaTimingLabel(r)).toBe("12m to attend");
  });

  it("is 'breached' when on site after target", () => {
    const r = computeAlarmSla({
      receivedAt: received,
      arrivedAt: mins(28),
      priority: "HIGH",
    });
    expect(r.status).toBe("breached");
    expect(r.responseMins).toBe(28);
  });

  it("respects a per-site override", () => {
    const r = computeAlarmSla({
      receivedAt: received,
      arrivedAt: mins(12),
      priority: "HIGH",
      targetOverrideMins: 10, // tighter than the 20-min default
    });
    expect(r.targetMins).toBe(10);
    expect(r.status).toBe("breached");
  });
});

describe("summariseAlarmSla", () => {
  it("counts met / breached / open and averages response", () => {
    const s = summariseAlarmSla([
      { status: "met", responseMins: 10, arrived: true },
      { status: "met", responseMins: 20, arrived: true },
      { status: "breached", responseMins: 40, arrived: true },
      { status: "responding", responseMins: null, arrived: false },
      { status: "breached", responseMins: null, arrived: false }, // open + over
    ]);
    expect(s.total).toBe(5);
    expect(s.arrived).toBe(3);
    expect(s.met).toBe(2);
    expect(s.breached).toBe(2); // one arrived-late + one open-over
    expect(s.open).toBe(2);
    expect(s.avgResponseMins).toBe(23); // (10+20+40)/3 = 23.3 → 23
    expect(s.slaMetPct).toBe(67); // 2/3
  });

  it("returns null averages with no arrivals", () => {
    const s = summariseAlarmSla([
      { status: "responding", responseMins: null, arrived: false },
    ]);
    expect(s.avgResponseMins).toBeNull();
    expect(s.slaMetPct).toBeNull();
  });
});
