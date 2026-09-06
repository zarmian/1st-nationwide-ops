import { describe, expect, it } from "vitest";
import {
  parseBonlineCall,
  isUkMobile,
  isBonlineLegShape,
  parseBonlineLeg,
  deriveCallFromLegs,
  isExternalNumber,
} from "./bonline";

// Real bOnline call-state legs for one inbound call (07398400046 → office
// 442081678180): the external caller channel, one ringing-but-unanswered
// agent leg, and one agent leg that answered.
const CALLER_LEG = {
  status: "Up",
  call_id: "1788707046.2169733",
  is_caller: true,
  user_uuid: null,
  answer_time: "2026-09-06T15:04:07.042654+00:00",
  hangup_time: "2026-09-06T15:05:08.394461+00:00",
  reason_code: 16,
  creation_time: "2026-09-06T15:04:06.619+0000",
  conversation_id: "1788707046.2169733",
  caller_id_number: "",
  dialed_extension: "442081678180",
  peer_caller_id_number: "07398400046",
};
const RINGING_LEG = {
  status: "Ringing",
  call_id: "1788707060.2169752",
  is_caller: false,
  answer_time: null,
  hangup_time: "2026-09-06T15:04:26.407649+00:00",
  reason_code: 16,
  creation_time: "2026-09-06T15:04:20.184+0000",
  conversation_id: "1788707046.2169733",
  caller_id_number: "07398400046",
  dialed_extension: "442081678180",
  peer_caller_id_number: "07398400046",
};
const ANSWERED_LEG = {
  status: "Up",
  call_id: "1788707062.2169753",
  is_caller: false,
  answer_time: "2026-09-06T15:04:26.370218+00:00",
  hangup_time: "2026-09-06T15:05:08.423719+00:00",
  reason_code: 16,
  creation_time: "2026-09-06T15:04:22.349+0000",
  conversation_id: "1788707046.2169733",
  caller_id_number: "07398400046",
  dialed_extension: "442081678180",
  peer_caller_id_number: "07398400046",
};

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

describe("bOnline call-state legs", () => {
  it("recognises a leg webhook vs a generic call webhook", () => {
    expect(isBonlineLegShape(CALLER_LEG)).toBe(true);
    expect(isBonlineLegShape(RINGING_LEG)).toBe(true);
    expect(
      isBonlineLegShape({ status: "missed", from: "07700900123", to: "0800" }),
    ).toBe(false);
    expect(isBonlineLegShape(null)).toBe(false);
  });

  it("parses a leg's fields", () => {
    const leg = parseBonlineLeg(ANSWERED_LEG);
    expect(leg.legId).toBe("1788707062.2169753");
    expect(leg.conversationId).toBe("1788707046.2169733");
    expect(leg.isCaller).toBe(false);
    expect(leg.callerNumber).toBe("07398400046");
    expect(leg.dialedNumber).toBe("442081678180");
    expect(leg.answerTime?.toISOString()).toBe("2026-09-06T15:04:26.370Z");
  });

  it("folds the three legs of one call into an ANSWERED result", () => {
    const d = deriveCallFromLegs(
      [CALLER_LEG, RINGING_LEG, ANSWERED_LEG].map(parseBonlineLeg),
    );
    expect(d.answered).toBe(true);
    expect(d.missed).toBe(false);
    expect(d.status).toBe("ANSWERED");
    expect(d.fromNumber).toBe("07398400046");
    expect(d.toNumber).toBe("442081678180");
    expect(d.direction).toBe("INBOUND");
    // Earliest creation across the legs.
    expect(d.occurredAt?.toISOString()).toBe("2026-09-06T15:04:06.619Z");
    // Answer (15:04:26.370) → last hangup (15:05:08.423) ≈ 42s talk time.
    expect(d.durationSec).toBe(42);
  });

  it("flags a call as MISSED when the caller hangs up with no agent answer", () => {
    // The ringing leg never answers; the caller leg hangs up.
    const d = deriveCallFromLegs([RINGING_LEG, CALLER_LEG].map(parseBonlineLeg));
    expect(d.answered).toBe(false);
    expect(d.ended).toBe(true);
    expect(d.missed).toBe(true);
    expect(d.status).toBe("MISSED");
    expect(d.fromNumber).toBe("07398400046");
  });

  it("stays IN_PROGRESS while the caller leg is still up", () => {
    const ongoingCaller = { ...CALLER_LEG, hangup_time: null };
    const d = deriveCallFromLegs([ongoingCaller].map(parseBonlineLeg));
    expect(d.ended).toBe(false);
    expect(d.missed).toBe(false);
    expect(d.status).toBe("IN_PROGRESS");
  });

  it("adding the answered leg later flips a missed call to answered", () => {
    // Out-of-order safety: re-derive from all legs each time.
    const missed = deriveCallFromLegs(
      [RINGING_LEG, CALLER_LEG].map(parseBonlineLeg),
    );
    expect(missed.missed).toBe(true);
    const withAnswer = deriveCallFromLegs(
      [RINGING_LEG, CALLER_LEG, ANSWERED_LEG].map(parseBonlineLeg),
    );
    expect(withAnswer.missed).toBe(false);
    expect(withAnswer.answered).toBe(true);
  });
});

describe("isExternalNumber", () => {
  it("accepts real numbers and rejects short extensions", () => {
    expect(isExternalNumber("07398400046")).toBe(true);
    expect(isExternalNumber("442081678180")).toBe(true);
    expect(isExternalNumber("+447700900123")).toBe(true);
    expect(isExternalNumber("201")).toBe(false);
    expect(isExternalNumber("")).toBe(false);
    expect(isExternalNumber(null)).toBe(false);
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
