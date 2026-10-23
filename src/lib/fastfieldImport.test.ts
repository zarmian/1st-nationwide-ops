import { describe, it, expect } from "vitest";
import { dueForRecheck, RULES_CHANGED_AT, type WaitingReport, type WorkChange } from "./fastfieldImport";

const NOW = new Date("2026-10-23T13:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const report = (
  id: string,
  siteId: string | null,
  atHours: number,
  lastLookHours: number,
): WaitingReport => ({
  id,
  siteId,
  at: h(atHours),
  submittedAt: h(atHours + 0.1),
  lastLook: h(lastLookHours),
});

const change = (siteId: string, changedHours: number, fromHours: number, toHours: number): WorkChange => ({
  siteId,
  changedAt: h(changedHours),
  from: h(fromHours),
  to: h(toHours),
});

describe("dueForRecheck", () => {
  it("puts reports whose site got a shift after they were tried first, newest first", () => {
    // Reports filed during last night's shift at Wokingham, tried at import;
    // the shift was logged this morning.
    const rows = [
      report("old-dartford", "dartford", -150, -2), // tried 2 h ago, nothing new
      report("wok-21h", "wokingham", -16, -15.5),
      report("wok-03h", "wokingham", -10, -9.5),
    ];
    const shift = change("wokingham", -1, -19, -4);
    expect(dueForRecheck(rows, [shift], null, NOW)).toEqual(["wok-03h", "wok-21h"]);
  });

  it("ignores work changed before the report was last tried, or far from its time", () => {
    const rows = [report("r1", "s1", -30, -2)];
    expect(dueForRecheck(rows, [change("s1", -3, -31, -29)], null, NOW)).toEqual([]);
    expect(dueForRecheck(rows, [change("s1", -1, -120, -110)], null, NOW)).toEqual([]);
    expect(dueForRecheck(rows, [change("other", -1, -31, -29)], null, NOW)).toEqual([]);
  });

  it("tries everything once a site has been added or changed", () => {
    const rows = [report("a", null, -20, -5), report("b", "s1", -10, -5)];
    expect(dueForRecheck(rows, [], h(-1), NOW)).toEqual(["b", "a"]);
    expect(dueForRecheck(rows, [], h(-6), NOW)).toEqual([]);
  });

  it("tries a report not looked at for a day, longest-waiting first", () => {
    const rows = [report("x", "s1", -50, -30), report("y", "s1", -60, -40), report("z", "s1", -5, -1)];
    expect(dueForRecheck(rows, [], null, NOW)).toEqual(["y", "x"]);
  });

  it("with all, adds the rest after the due ones", () => {
    const rows = [report("due", "s1", -10, -9), report("fresh", "s2", -3, -1)];
    const ids = dueForRecheck(rows, [change("s1", -2, -11, -8)], null, NOW, true);
    expect(ids).toEqual(["due", "fresh"]);
  });

  it("has the rules' change date in the past, so a pass after it settles", () => {
    expect(RULES_CHANGED_AT.getTime()).toBeLessThan(Date.now());
  });
});
