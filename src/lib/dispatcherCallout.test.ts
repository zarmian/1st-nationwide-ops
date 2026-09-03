import { describe, expect, it } from "vitest";
import {
  CalloutInput,
  DISPATCHER_BACKDATE_DAYS,
  checkBackdateAllowed,
} from "./dispatcherCallout";

const VALID_SITE = "00000000-0000-4000-8000-000000000001";
const VALID_OFFICER = "00000000-0000-4000-8000-000000000002";

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  const start = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const end = new Date(Date.now() - 30 * 60 * 1000); // 30m ago
  return {
    siteId: VALID_SITE,
    type: "ALARM_RESPONSE" as const,
    source: "ALARM" as const,
    officerId: VALID_OFFICER,
    startedAt: start.toISOString(),
    completedAt: end.toISOString(),
    notes: null,
    excludeFromClientReport: false,
    partnerReportRef: null,
    ...overrides,
  };
}

describe("CalloutInput — happy path", () => {
  it("accepts a well-formed input", () => {
    const r = CalloutInput.safeParse(baseInput());
    expect(r.success).toBe(true);
  });
});

describe("CalloutInput — time rules", () => {
  it("rejects end ≤ start", () => {
    const t = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const r = CalloutInput.safeParse(
      baseInput({ startedAt: t, completedAt: t }),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.flatten().fieldErrors.completedAt ?? [];
      expect(msgs.some((m) => m.includes("after start"))).toBe(true);
    }
  });

  it("rejects start in the future", () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const r = CalloutInput.safeParse(
      baseInput({ startedAt: future, completedAt: end }),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.flatten().fieldErrors.startedAt ?? [];
      expect(msgs.some((m) => m.includes("future"))).toBe(true);
    }
  });

  it("tolerates ~1 minute of clock skew on start time", () => {
    const slightlyFuture = new Date(Date.now() + 30 * 1000).toISOString();
    const end = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const r = CalloutInput.safeParse(
      baseInput({ startedAt: slightlyFuture, completedAt: end }),
    );
    expect(r.success).toBe(true);
  });
});

describe("CalloutInput — bad ids", () => {
  it("rejects a non-UUID siteId", () => {
    const r = CalloutInput.safeParse(baseInput({ siteId: "not-a-uuid" }));
    expect(r.success).toBe(false);
  });

  it("rejects a non-UUID officerId", () => {
    const r = CalloutInput.safeParse(baseInput({ officerId: "x" }));
    expect(r.success).toBe(false);
  });
});

describe("CalloutInput — enums", () => {
  it("rejects a job type that isn't a callout type", () => {
    const r = CalloutInput.safeParse(baseInput({ type: "DOG_HANDLER_SHIFT" }));
    expect(r.success).toBe(false);
  });

  it("rejects SCHEDULED as a source (callouts are reactive, not scheduled)", () => {
    const r = CalloutInput.safeParse(baseInput({ source: "SCHEDULED" }));
    expect(r.success).toBe(false);
  });
});

describe("CalloutInput — partner handler", () => {
  const VALID_PARTNER = "00000000-0000-4000-8000-00000000000a";

  it("accepts a hand-off to a partner with just a partner picked", () => {
    const r = CalloutInput.safeParse({
      siteId: VALID_SITE,
      type: "ALARM_RESPONSE",
      source: "PARTNER_REQUEST",
      handlerKind: "partner",
      handlerPartnerId: VALID_PARTNER,
      handedOffAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      notes: "Given to Nexus 30/05",
      excludeFromClientReport: false,
      partnerReportRef: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects partner handler with no partner picked", () => {
    const r = CalloutInput.safeParse({
      siteId: VALID_SITE,
      type: "ALARM_RESPONSE",
      source: "PARTNER_REQUEST",
      handlerKind: "partner",
      handedOffAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      excludeFromClientReport: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.flatten().fieldErrors.handlerPartnerId ?? [];
      expect(msgs.length).toBeGreaterThan(0);
    }
  });

  it("attendance times are optional when handler is partner", () => {
    // No startedAt or completedAt — admin doesn't know yet.
    const r = CalloutInput.safeParse({
      siteId: VALID_SITE,
      type: "ALARM_RESPONSE",
      source: "PARTNER_REQUEST",
      handlerKind: "partner",
      handlerPartnerId: VALID_PARTNER,
      handedOffAt: new Date().toISOString(),
      excludeFromClientReport: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a future hand-off time", () => {
    const r = CalloutInput.safeParse({
      siteId: VALID_SITE,
      type: "ALARM_RESPONSE",
      source: "PARTNER_REQUEST",
      handlerKind: "partner",
      handlerPartnerId: VALID_PARTNER,
      handedOffAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      excludeFromClientReport: false,
    });
    expect(r.success).toBe(false);
  });

  it("officer flow still works with handlerKind unset (default = officer)", () => {
    // Backwards-compatible: forms that don't yet send handlerKind keep
    // working under the existing officer flow.
    const r = CalloutInput.safeParse(baseInput());
    expect(r.success).toBe(true);
  });
});

describe("checkBackdateAllowed", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("allows dispatcher to record a callout from earlier today", () => {
    const t = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    expect(checkBackdateAllowed(t, "DISPATCHER", now)).toBeNull();
  });

  it("allows dispatcher to record a callout from 29 days ago", () => {
    const t = new Date(
      now.getTime() - (DISPATCHER_BACKDATE_DAYS - 1) * 24 * 60 * 60 * 1000,
    );
    expect(checkBackdateAllowed(t, "DISPATCHER", now)).toBeNull();
  });

  it("blocks dispatcher from recording a callout from 31 days ago", () => {
    const t = new Date(
      now.getTime() - (DISPATCHER_BACKDATE_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    const err = checkBackdateAllowed(t, "DISPATCHER", now);
    expect(err).not.toBeNull();
    expect(err).toContain(`${DISPATCHER_BACKDATE_DAYS} days`);
  });

  it("admin bypasses the cap — can record callouts from years ago", () => {
    const t = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    expect(checkBackdateAllowed(t, "ADMIN", now)).toBeNull();
  });

  it("officer (somehow calling the action) is treated like dispatcher", () => {
    const t = new Date(
      now.getTime() - (DISPATCHER_BACKDATE_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    expect(checkBackdateAllowed(t, "OFFICER", now)).not.toBeNull();
  });
});
