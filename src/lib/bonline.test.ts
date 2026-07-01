import { describe, expect, it } from "vitest";
import { parseBonlineCall, isUkMobile } from "./bonline";

describe("parseBonlineCall", () => {
  it("detects a missed call from a status string", () => {
    const r = parseBonlineCall({
      id: "abc123",
      direction: "inbound",
      status: "no-answer",
      from: "07700900123",
      to: "02071234567",
      duration: 0,
      timestamp: "2026-06-22T09:30:00Z",
    });
    expect(r.missed).toBe(true);
    expect(r.status).toBe("MISSED");
    expect(r.direction).toBe("INBOUND");
    expect(r.externalId).toBe("abc123");
    expect(r.fromNumber).toBe("07700900123");
    expect(r.durationSec).toBe(0);
    expect(r.occurredAt?.toISOString()).toBe("2026-06-22T09:30:00.000Z");
  });

  it("honours an explicit missed boolean", () => {
    const r = parseBonlineCall({ missed: true, callStatus: "whatever" });
    expect(r.missed).toBe(true);
  });

  it("treats an answered call as not missed", () => {
    const r = parseBonlineCall({ status: "answered", direction: "outbound" });
    expect(r.missed).toBe(false);
    expect(r.status).toBe("ANSWERED");
    expect(r.direction).toBe("OUTBOUND");
  });

  it("reads fields from a nested wrapper", () => {
    const r = parseBonlineCall({
      event: "call.missed",
      data: { call_id: "x", caller: "+447700900999", destination: "0800111222" },
    });
    expect(r.missed).toBe(true);
    expect(r.externalId).toBe("x");
    expect(r.fromNumber).toBe("+447700900999");
  });

  it("parses epoch-seconds timestamps", () => {
    const r = parseBonlineCall({ status: "missed", startTime: 1_781_000_000 });
    expect(r.occurredAt?.getTime()).toBe(1_781_000_000 * 1000);
  });

  it("never throws on junk / empty payloads and defaults to not-missed", () => {
    expect(parseBonlineCall(null).missed).toBe(false);
    expect(parseBonlineCall("nonsense").missed).toBe(false);
    expect(parseBonlineCall({}).status).toBe("UNKNOWN");
    expect(parseBonlineCall([1, 2, 3]).missed).toBe(false);
  });
});

describe("isUkMobile", () => {
  it("accepts UK mobiles in local and E.164 form", () => {
    expect(isUkMobile("07700900123")).toBe(true);
    expect(isUkMobile("+447700900123")).toBe(true);
    expect(isUkMobile("07700 900 123")).toBe(true);
  });
  it("rejects landlines and junk", () => {
    expect(isUkMobile("02071234567")).toBe(false);
    expect(isUkMobile("+441234567890")).toBe(false);
    expect(isUkMobile(null)).toBe(false);
    expect(isUkMobile("")).toBe(false);
  });
});
