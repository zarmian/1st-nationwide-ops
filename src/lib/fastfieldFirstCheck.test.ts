import { describe, expect, it } from "vitest";
import {
  FIRST_CHECK_FROM,
  FIRST_CHECK_TO,
  firstCheckEvents,
  firstCheckHidden,
  firstEventPerReport,
  putBackMode,
  type FirstCheckState,
  type HistoryRow,
} from "./fastfieldFirstCheck";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const SHIFT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHIFT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERSON = "99999999-9999-4999-8999-999999999999";

const row = (over: Partial<HistoryRow> & Pick<HistoryRow, "entityId" | "action">): HistoryRow => ({
  diff: {},
  createdAt: new Date("2026-11-24T07:00:00Z"),
  userId: null,
  ...over,
});

describe("the first check's window", () => {
  it("is 24 Nov, 06:30 to 19:30 UTC", () => {
    expect(FIRST_CHECK_FROM.toISOString()).toBe("2026-11-24T06:30:00.000Z");
    expect(FIRST_CHECK_TO.toISOString()).toBe("2026-11-24T19:30:00.000Z");
  });
});

describe("firstCheckEvents", () => {
  it("takes the robot's moves and take-offs in the window, earliest first", () => {
    const events = firstCheckEvents([
      row({
        entityId: SHIFT_B,
        action: "fastfield_unlinked",
        diff: { fastfieldReportId: R1, by: "robot" },
        createdAt: new Date("2026-11-24T09:30:00Z"),
      }),
      row({
        entityId: SHIFT_A,
        action: "fastfield_moved_off",
        diff: { fastfieldReportId: R1, toShiftId: SHIFT_B },
        createdAt: new Date("2026-11-24T06:35:00Z"),
      }),
    ]);
    expect(events).toEqual([
      { reportId: R1, shiftId: SHIFT_A, what: "moved", at: new Date("2026-11-24T06:35:00Z") },
      { reportId: R1, shiftId: SHIFT_B, what: "takenOff", at: new Date("2026-11-24T09:30:00Z") },
    ]);
  });

  it("leaves out a person's unlink, other actions and anything outside the window", () => {
    expect(
      firstCheckEvents([
        // A person's Unlink: a user, and no by: "robot".
        row({ entityId: SHIFT_A, action: "fastfield_unlinked", diff: { fastfieldReportId: R1 }, userId: PERSON }),
        row({ entityId: SHIFT_A, action: "fastfield_unlinked", diff: { fastfieldReportId: R1 } }),
        row({ entityId: SHIFT_A, action: "fastfield_moved_off", diff: { fastfieldReportId: R1 }, userId: PERSON }),
        // Not a move or take-off.
        row({ entityId: SHIFT_A, action: "fastfield_put_back", diff: { fastfieldReportId: R1 } }),
        row({ entityId: SHIFT_A, action: "fastfield_moved_on", diff: { fastfieldReportId: R1 } }),
        // Before and after the first check.
        row({
          entityId: SHIFT_A,
          action: "fastfield_moved_off",
          diff: { fastfieldReportId: R1 },
          createdAt: new Date("2026-11-24T06:29:59Z"),
        }),
        row({
          entityId: SHIFT_A,
          action: "fastfield_unlinked",
          diff: { fastfieldReportId: R1, by: "robot" },
          createdAt: new Date("2026-11-24T19:30:01Z"),
        }),
      ]),
    ).toEqual([]);
  });

  it("skips rows it can't read", () => {
    expect(
      firstCheckEvents([
        row({ entityId: SHIFT_A, action: "fastfield_moved_off", diff: null }),
        row({ entityId: SHIFT_A, action: "fastfield_moved_off", diff: ["x"] }),
        row({ entityId: SHIFT_A, action: "fastfield_moved_off", diff: { fastfieldReportId: "not-an-id" } }),
        row({ entityId: "not-a-shift", action: "fastfield_moved_off", diff: { fastfieldReportId: R1 } }),
      ]),
    ).toEqual([]);
  });
});

describe("firstEventPerReport", () => {
  it("keeps each report's first event: the shift it was on before the robot touched it", () => {
    const m = firstEventPerReport([
      { reportId: R1, shiftId: SHIFT_B, what: "takenOff", at: new Date("2026-11-24T09:30:00Z") },
      { reportId: R2, shiftId: SHIFT_C, what: "takenOff", at: new Date("2026-11-24T08:00:00Z") },
      { reportId: R1, shiftId: SHIFT_A, what: "moved", at: new Date("2026-11-24T06:35:00Z") },
    ]);
    expect(m.get(R1)).toMatchObject({ shiftId: SHIFT_A, what: "moved" });
    expect(m.get(R2)).toMatchObject({ shiftId: SHIFT_C, what: "takenOff" });
    expect(m.size).toBe(2);
  });
});

describe("putBackMode", () => {
  const free: FirstCheckState = {
    status: "UNMATCHED",
    linkedByHand: false,
    shiftId: null,
    jobId: null,
    patrolVisitId: null,
    formSubmissionId: null,
  };
  const onRobotShift = (shiftId: string): FirstCheckState => ({
    ...free,
    status: "LINKED",
    shiftId,
    formSubmissionId: "sub",
  });

  it("links a free report (waiting or set aside) by hand", () => {
    expect(putBackMode(free, SHIFT_A)).toBe("link");
    expect(putBackMode({ ...free, status: "IGNORED" }, SHIFT_A)).toBe("link");
  });

  it("moves a report the robot has on another shift, or keeps one it put back there", () => {
    expect(putBackMode(onRobotShift(SHIFT_B), SHIFT_A)).toBe("move");
    expect(putBackMode(onRobotShift(SHIFT_A), SHIFT_A)).toBe("keep");
  });

  it("won't touch a hand link, a job or visit link, a created job or a half-attached report", () => {
    expect(putBackMode({ ...onRobotShift(SHIFT_B), linkedByHand: true }, SHIFT_A)).toBeNull();
    expect(putBackMode({ ...free, status: "LINKED", jobId: "job", formSubmissionId: "sub" }, SHIFT_A)).toBeNull();
    expect(putBackMode({ ...free, status: "LINKED", patrolVisitId: "v", formSubmissionId: "sub" }, SHIFT_A)).toBeNull();
    expect(putBackMode({ ...free, status: "CREATED", jobId: "job", formSubmissionId: "sub" }, SHIFT_A)).toBeNull();
    expect(putBackMode({ ...free, formSubmissionId: "left-over" }, SHIFT_A)).toBeNull();
    expect(putBackMode({ ...free, status: "LINKED" }, SHIFT_A)).toBeNull();
  });
});

describe("firstCheckHidden", () => {
  it("hides a report a person dealt with, one linked by hand since, and one whose shift is gone", () => {
    expect(firstCheckHidden({ reviewed: false, linkedByHand: false, shiftExists: true })).toBeNull();
    expect(firstCheckHidden({ reviewed: true, linkedByHand: false, shiftExists: true })).toBe("reviewed");
    expect(firstCheckHidden({ reviewed: false, linkedByHand: true, shiftExists: true })).toBe("byHand");
    expect(firstCheckHidden({ reviewed: false, linkedByHand: false, shiftExists: false })).toBe("shiftGone");
    // Counted as "shift gone" only when nothing else already hides it.
    expect(firstCheckHidden({ reviewed: true, linkedByHand: false, shiftExists: false })).toBe("reviewed");
  });
});
