import { describe, it, expect } from "vitest";
import {
  ACTIVITY_GROUPS,
  summariseClientActivities,
  groupTotals,
  periodKey,
  periodLabel,
  periodShortLabel,
  periodKeysBetween,
  jobKindLabel,
  jobGroup,
  isActivityGroup,
  invoiceState,
  type ActivityGroup,
} from "./clientPortal";

describe("jobKindLabel", () => {
  it("folds shift-equivalent job types into the same label as real shifts", () => {
    // A static-guarding job (with its own typeLabel) must read identically to
    // a static-guarding Shift, so the portal shows one type, not two.
    expect(jobKindLabel("STATIC_GUARDING_SHIFT", "Static guarding shift")).toBe(
      "Static guarding",
    );
    expect(jobKindLabel("STATIC_GUARDING_SHIFT", null)).toBe("Static guarding");
    expect(jobKindLabel("DOG_HANDLER_SHIFT", "Dog handler shift")).toBe(
      "Dog handler",
    );
  });

  it("keeps other job kinds as their label / mapping / prettified type", () => {
    expect(jobKindLabel("ALARM_RESPONSE", null)).toBe("Alarm response");
    expect(jobKindLabel("LOCK", "Custom lock label")).toBe("Custom lock label");
    expect(jobKindLabel("SOMETHING_NEW", null)).toBe("SOMETHING NEW");
  });
});

// Raw activity literals (structural match of the internal RawActivity type).
const mk = (
  group: ActivityGroup,
  siteId: string,
  siteName: string,
  at: string,
  billed: number,
  hours: number | null = null,
) => ({
  id: `${group}:${at}`,
  group,
  hours,
  siteId,
  siteName,
  siteCode: null,
  at: new Date(at),
  status: "Completed" as const,
  billed,
});

describe("period helpers — month", () => {
  it("keys and labels a date in UK time", () => {
    expect(periodKey(new Date("2026-09-15T12:00:00Z"), "month")).toBe("2026-09");
    expect(periodLabel("2026-09", "month")).toBe("Sept 2026");
  });

  it("spans an inclusive month range", () => {
    expect(
      periodKeysBetween(
        new Date("2026-07-10T12:00:00Z"),
        new Date("2026-10-02T12:00:00Z"),
        "month",
      ),
    ).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("handles a year boundary", () => {
    expect(
      periodKeysBetween(
        new Date("2026-11-01T12:00:00Z"),
        new Date("2027-01-01T12:00:00Z"),
        "month",
      ),
    ).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("period helpers — week", () => {
  it("keys a date to the Monday of its UK week", () => {
    expect(periodKey(new Date("2026-09-15T12:00:00Z"), "week")).toBe(
      "2026-09-14",
    ); // Tue → Mon 14th
    expect(periodKey(new Date("2026-09-14T12:00:00Z"), "week")).toBe(
      "2026-09-14",
    ); // Mon → itself
    expect(periodKey(new Date("2026-09-20T12:00:00Z"), "week")).toBe(
      "2026-09-14",
    ); // Sun → Mon 14th
  });

  it("steps a week range by Mondays", () => {
    expect(
      periodKeysBetween(
        new Date("2026-09-01T12:00:00Z"),
        new Date("2026-09-20T12:00:00Z"),
        "week",
      ),
    ).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
  });
});

describe("periodKeysBetween — UK month starts", () => {
  it("doesn't add the month before when the range starts at UK midnight on the 1st", () => {
    // 1 Sept 2026 00:00 BST is still 31 August in UTC.
    expect(
      periodKeysBetween(new Date("2026-08-31T23:00:00Z"), new Date("2026-10-23T12:00:00Z"), "month"),
    ).toEqual(["2026-09", "2026-10"]);
  });
});

describe("periodShortLabel", () => {
  it("keeps axis labels short", () => {
    expect(periodShortLabel("2026-09", "month", false)).toBe("Sept");
    expect(periodShortLabel("2026-09-14", "week", false)).toBe("14 Sept");
    expect(periodShortLabel("2026-09-05", "day", true)).toBe("5");
    expect(periodShortLabel("2026-10-01", "day", false)).toBe("1 Oct");
  });
});

describe("summariseClientActivities", () => {
  const months = ["2026-08", "2026-09"];
  const rows = [
    mk("patrol", "s1", "Alpha House", "2026-08-05T12:00:00Z", 40),
    mk("patrol", "s1", "Alpha House", "2026-09-05T12:00:00Z", 40),
    mk("callout", "s2", "Beta Depot", "2026-09-06T12:00:00Z", 120),
    mk("lockup", "s1", "Alpha House", "2026-09-07T12:00:00Z", 20),
    mk("guarding", "s2", "Beta Depot", "2026-09-08T19:00:00Z", 240, 12),
    mk("guarding", "s2", "Beta Depot", "2026-09-09T19:00:00Z", 230, 11.5),
  ];

  it("totals activities, spend and guarding hours", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.totalActivities).toBe(6);
    expect(s.totalSpend).toBe(690);
    expect(s.guardingHours).toBe(23.5);
  });

  it("totals each type of work in the fixed order, zeros included", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.byGroup.map((g) => g.group)).toEqual(ACTIVITY_GROUPS.map((g) => g.key));
    expect(s.byGroup.find((g) => g.group === "guarding")).toEqual({
      group: "guarding",
      count: 2,
      hours: 23.5,
      charged: 470,
    });
    expect(s.byGroup.find((g) => g.group === "unlock")!.count).toBe(0);
  });

  it("sums spend per site, highest first", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.spendBySite[0]).toEqual({ siteId: "s2", siteName: "Beta Depot", amount: 590 });
    expect(s.spendBySite[1].amount).toBe(100);
  });

  it("splits each period by type of work, zero-filling the range", () => {
    const s = summariseClientActivities(rows, months, "month");
    expect(s.byPeriod.map((p) => [p.key, p.label, p.short, p.count, p.charged])).toEqual([
      ["2026-08", "Aug 2026", "Aug", 1, 40],
      ["2026-09", "Sept 2026", "Sept", 5, 650],
    ]);
    const sept = s.byPeriod[1].groups;
    expect(sept.map((g) => g.group)).toEqual(ACTIVITY_GROUPS.map((g) => g.key));
    expect(sept.find((g) => g.group === "guarding")).toEqual({ group: "guarding", count: 2, hours: 23.5 });
    expect(sept.find((g) => g.group === "callout")!.count).toBe(1);
    expect(sept.find((g) => g.group === "unlock")!.count).toBe(0);
  });

  it("buckets by week when asked", () => {
    const weekKeys = ["2026-08-31", "2026-09-07"];
    const weekRows = [
      mk("patrol", "s1", "Alpha", "2026-09-01T12:00:00Z", 10), // wk 08-31
      mk("patrol", "s1", "Alpha", "2026-09-08T12:00:00Z", 10), // wk 09-07
      mk("callout", "s1", "Alpha", "2026-09-09T12:00:00Z", 10), // wk 09-07
    ];
    const s = summariseClientActivities(weekRows, weekKeys, "week");
    expect(s.byPeriod.map((p) => p.count)).toEqual([1, 2]);
    expect(s.byPeriod[1].label).toBe("Week of 7 Sept");
  });

  it("zero-fills periods with no activity", () => {
    const s = summariseClientActivities([], ["2026-09"], "month");
    expect(s.totalActivities).toBe(0);
    expect(s.guardingHours).toBe(0);
    expect(s.byPeriod[0]).toMatchObject({ key: "2026-09", count: 0, charged: 0 });
  });
});

describe("groupTotals", () => {
  it("counts rows without hours as no hours", () => {
    const t = groupTotals([
      { group: "guarding", hours: null, billed: 0 },
      { group: "guarding", hours: 8, billed: 100 },
    ]);
    expect(t.find((g) => g.group === "guarding")).toEqual({
      group: "guarding",
      count: 2,
      hours: 8,
      charged: 100,
    });
  });
});

describe("activity types for the filter", () => {
  it("puts each job type in a group", () => {
    expect(jobGroup("ALARM_RESPONSE")).toBe("callout");
    expect(jobGroup("ADHOC")).toBe("callout");
    expect(jobGroup("LOCK")).toBe("lockup");
    expect(jobGroup("UNLOCK")).toBe("unlock");
    expect(jobGroup("STATIC_GUARDING_SHIFT")).toBe("guarding");
    expect(jobGroup("VPI")).toBe("patrol");
    expect(jobGroup("KEY_COLLECTION")).toBe("other");
  });
  it("only accepts known groups from a URL", () => {
    expect(isActivityGroup("lockup")).toBe(true);
    expect(isActivityGroup("lock")).toBe(false);
    expect(isActivityGroup("LOCKUP")).toBe(false);
    expect(isActivityGroup(undefined)).toBe(false);
  });
});

describe("invoiceState", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const due = (d: string) => new Date(`${d}T00:00:00Z`);
  it("is paid when marked paid or nothing is left", () => {
    expect(invoiceState({ status: "PAID", total: 120, paid: 0, credited: 0, dueAt: null }, now)).toEqual({ balance: 0, state: "Paid" });
    expect(invoiceState({ status: "SENT", total: 120, paid: 100, credited: 20, dueAt: due("2026-10-01") }, now)).toEqual({ balance: 0, state: "Paid" });
  });
  it("is overdue once the due date has passed", () => {
    expect(invoiceState({ status: "SENT", total: 120, paid: 20, credited: 0, dueAt: due("2026-10-01") }, now)).toEqual({ balance: 100, state: "Overdue" });
  });
  it("is unpaid before the due date", () => {
    expect(invoiceState({ status: "SENT", total: 99.99, paid: 0, credited: 0, dueAt: due("2026-11-01") }, now)).toEqual({ balance: 99.99, state: "Unpaid" });
  });
});
