import { describe, it, expect } from "vitest";
import { checkReportOnShift, dueForRecheck, NO_TYPED_TIME, type WaitingReport, type WorkChange } from "./fastfieldImport";
import { FASTFIELD_RULES_VERSION } from "./fastfieldRulesVersion";

const NOW = new Date("2026-10-23T13:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const report = (
  id: string,
  siteId: string | null,
  atHours: number,
  lastLookHours: number,
  rulesVersion: number = FASTFIELD_RULES_VERSION,
): WaitingReport => ({
  id,
  siteId,
  at: h(atHours),
  submittedAt: h(atHours + 0.1),
  lastLook: h(lastLookHours),
  rulesVersion,
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

  it("tries again, newest first, every report judged under older rules — however recently", () => {
    const old = FASTFIELD_RULES_VERSION - 1;
    const rows = [
      report("old-rules-1h", "s1", -40, -1, old), // tried an hour ago, by the old rules
      report("old-rules-new", "s1", -2, -0.5, old),
      report("current", "s1", -30, -1), // current rules, tried recently: not due
    ];
    expect(dueForRecheck(rows, [], null, NOW)).toEqual(["old-rules-new", "old-rules-1h"]);
  });

  it("puts work near a report ahead of the rules bucket, and the rules bucket ahead of stale ones", () => {
    const old = FASTFIELD_RULES_VERSION - 1;
    const rows = [
      report("stale", "s1", -60, -30), // not tried for 30 h
      report("old-rules", "s2", -50, -2, old),
      report("work", "s3", -10, -9),
    ];
    const ids = dueForRecheck(rows, [change("s3", -1, -11, -8)], null, NOW);
    expect(ids).toEqual(["work", "old-rules", "stale"]);
  });

  it("stops picking a report once it is judged under the current rules", () => {
    const old = FASTFIELD_RULES_VERSION - 1;
    expect(dueForRecheck([report("r", "s1", -5, -1, old)], [], null, NOW)).toEqual(["r"]);
    // The same report after the retry stamped it (checkedAt now, current version).
    expect(dueForRecheck([report("r", "s1", -5, 0)], [], null, NOW)).toEqual([]);
  });
});

describe("checkReportOnShift: only typed times", () => {
  const shift = {
    id: "s1",
    officerId: null,
    scheduledStartsAt: new Date("2026-11-23T19:00:00Z"),
    scheduledEndsAt: new Date("2026-11-24T07:00:00Z"),
    actualStartedAt: null,
    actualEndedAt: null,
  };

  it("can't check a report with no typed time — it's flagged for a person, never judged by its send time", () => {
    // Sent at 02:00, well inside the shift: that doesn't count.
    const c = checkReportOnShift({ submittedAt: new Date("2026-11-24T02:00:00Z"), answers: [] }, shift);
    expect(c.span).toBeNull();
    expect(c.outside).toBe(NO_TYPED_TIME);
  });

  it("checks a typed time as before", () => {
    const c = checkReportOnShift(
      {
        submittedAt: new Date("2026-11-24T08:00:00Z"),
        answers: [{ key: "a", label: "Arrival time", type: "DatePicker", value: "2026-11-24T02:00:00Z" }],
      },
      shift,
    );
    expect(c.outside).toBeNull();
  });
});
