import { describe, it, expect } from "vitest";
import {
  dailyReportDaysFor,
  dailyReportWindow,
  inDailyReport,
  type DailyReportActivity,
} from "./fastfieldSentToClient";

const day = (year: number, month: number, d: number) => ({ year, month, day: d });

describe("dailyReportWindow", () => {
  it("runs from UK midnight for 24 hours less a millisecond, as the email does", () => {
    expect(dailyReportWindow(day(2026, 11, 24))).toEqual({
      from: new Date("2026-11-24T00:00:00.000Z"),
      to: new Date("2026-11-24T23:59:59.999Z"),
    });
    // Summer time: UK midnight is 23:00 UTC the day before.
    expect(dailyReportWindow(day(2026, 7, 1))).toEqual({
      from: new Date("2026-06-30T23:00:00.000Z"),
      to: new Date("2026-07-01T22:59:59.999Z"),
    });
  });
});

describe("dailyReportDaysFor", () => {
  it("is the activity's own UK day", () => {
    expect(dailyReportDaysFor(new Date("2026-11-24T19:00:00Z"))).toEqual([day(2026, 11, 24)]);
    // 00:30 UK belongs to the new day, not the one before.
    expect(dailyReportDaysFor(new Date("2026-11-24T00:30:00Z"))).toEqual([day(2026, 11, 24)]);
    // 23:30 UK in summer is 22:30 UTC: still that UK day.
    expect(dailyReportDaysFor(new Date("2026-07-01T22:30:00Z"))).toEqual([day(2026, 7, 1)]);
  });

  it("after the short March day, the first hour is in both days' emails", () => {
    // 29 Mar 2026 has 23 hours; 00:30 BST on the 30th = 23:30 UTC on the 29th.
    expect(dailyReportDaysFor(new Date("2026-03-29T23:30:00Z"))).toEqual([
      day(2026, 3, 29),
      day(2026, 3, 30),
    ]);
  });

  it("the last hour of the long October day is in no email", () => {
    // 25 Oct 2026 has 25 hours; its email covers 00:00 BST to 22:59:59 GMT.
    expect(dailyReportDaysFor(new Date("2026-10-25T23:30:00Z"))).toEqual([]);
    expect(dailyReportDaysFor(new Date("2026-10-25T22:30:00Z"))).toEqual([day(2026, 10, 25)]);
  });
});

describe("inDailyReport", () => {
  const clients = { main: "main", alsoGuarding: "storage-2" };
  const shift = (over: Partial<Extract<DailyReportActivity, { kind: "shift" }>> = {}): DailyReportActivity => ({
    kind: "shift",
    type: "STATIC_GUARDING",
    status: "COMPLETED",
    at: new Date("2026-11-24T19:00:00Z"),
    customerId: "main",
    ...over,
  });
  const job = (over: Partial<Extract<DailyReportActivity, { kind: "job" }>> = {}): DailyReportActivity => ({
    kind: "job",
    type: "ALARM_RESPONSE",
    status: "APPROVED",
    at: new Date("2026-11-24T02:00:00Z"),
    completedAt: new Date("2026-11-24T02:40:00Z"),
    customerId: "main",
    ...over,
  });

  it("lists completed static-guarding shifts at either storage client's sites", () => {
    expect(inDailyReport(shift(), clients)).toBe(true);
    expect(inDailyReport(shift({ customerId: "storage-2" }), clients)).toBe(true);
    expect(inDailyReport(shift({ customerId: "someone-else" }), clients)).toBe(false);
    expect(inDailyReport(shift({ status: "IN_PROGRESS" }), clients)).toBe(false);
    expect(inDailyReport(shift({ status: "MISSED" }), clients)).toBe(false);
    expect(inDailyReport(shift({ type: "DOG_HANDLER" }), clients)).toBe(false);
  });

  it("lists the main client's completed jobs that weren't cancelled", () => {
    expect(inDailyReport(job(), clients)).toBe(true);
    expect(inDailyReport(job({ type: "LOCK" }), clients)).toBe(true);
    expect(inDailyReport(job({ customerId: "storage-2" }), clients)).toBe(false);
    expect(inDailyReport(job({ status: "CANCELLED" }), clients)).toBe(false);
    expect(inDailyReport(job({ completedAt: null }), clients)).toBe(false);
  });

  it("lists completed static-guarding callouts at either storage client's sites", () => {
    expect(inDailyReport(job({ type: "STATIC_GUARDING_SHIFT", customerId: "storage-2" }), clients)).toBe(true);
    expect(inDailyReport(job({ type: "STATIC_GUARDING_SHIFT", customerId: "someone-else" }), clients)).toBe(false);
  });

  it("lists nothing without a client to match", () => {
    expect(inDailyReport(shift({ customerId: null }), clients)).toBe(false);
    expect(inDailyReport(job(), { main: null, alsoGuarding: null })).toBe(false);
    expect(inDailyReport(shift(), { main: null, alsoGuarding: "storage-2" })).toBe(false);
  });
});
