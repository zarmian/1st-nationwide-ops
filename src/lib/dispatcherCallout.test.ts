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
  it("rejects an unknown job type", () => {
    const r = CalloutInput.safeParse(baseInput({ type: "STATIC_GUARDING_SHIFT" }));
    expect(r.success).toBe(false);
  });

  it("rejects SCHEDULED as a source (callouts are reactive, not scheduled)", () => {
    const r = CalloutInput.safeParse(baseInput({ source: "SCHEDULED" }));
    expect(r.success).toBe(false);
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
