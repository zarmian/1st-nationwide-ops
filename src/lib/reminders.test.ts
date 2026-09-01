import { describe, it, expect } from "vitest";
import { stageForDaysOverdue, REMINDER_STAGES } from "./reminders";

describe("stageForDaysOverdue", () => {
  it("returns null before the first threshold", () => {
    expect(stageForDaysOverdue(-3)).toBeNull();
    expect(stageForDaysOverdue(0)).toBeNull();
  });

  it("picks the exact threshold as it's crossed", () => {
    expect(stageForDaysOverdue(1)?.key).toBe("overdue_1");
    expect(stageForDaysOverdue(7)?.key).toBe("overdue_7");
    expect(stageForDaysOverdue(14)?.key).toBe("overdue_14");
    expect(stageForDaysOverdue(30)?.key).toBe("overdue_30");
  });

  it("returns the HIGHEST applicable stage between thresholds", () => {
    // Key property: a newly-tracked, very-overdue invoice gets one reminder
    // (the highest stage), never a burst of back-dated ones.
    expect(stageForDaysOverdue(3)?.key).toBe("overdue_1");
    expect(stageForDaysOverdue(10)?.key).toBe("overdue_7");
    expect(stageForDaysOverdue(20)?.key).toBe("overdue_14");
    expect(stageForDaysOverdue(90)?.key).toBe("overdue_30");
  });

  it("only ever returns a defined stage", () => {
    for (const d of [1, 5, 15, 45, 400]) {
      const s = stageForDaysOverdue(d);
      expect(s).not.toBeNull();
      expect(REMINDER_STAGES).toContainEqual(s!);
    }
  });
});
