import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  fastFieldForm: { findMany: vi.fn() },
  fastFieldReport: { findMany: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { recordRefusedReports, refusedNote, refusedSentAt } from "./fastfieldRefused";
import { FASTFIELD_RULES_VERSION } from "./fastfieldRulesVersion";

beforeEach(() => {
  vi.clearAllMocks();
  db.fastFieldForm.findMany.mockResolvedValue([{ formId: 101 }]); // form 101 is On
  db.fastFieldReport.findMany.mockResolvedValue([]);
  db.fastFieldReport.create.mockResolvedValue({ id: "r1" });
});

describe("refusedNote", () => {
  it("says plainly why the report isn't in the app and what to do", () => {
    expect(refusedNote("too_big")).toMatch(/^Couldn't import this report from FastField: it was too big\./);
    expect(refusedNote("invalid")).toMatch(/part of it couldn't be read/);
    for (const r of ["too_big", "invalid"] as const) {
      expect(refusedNote(r)).toMatch(/Open it in FastField to read it\. The robot won't try it again\.$/);
    }
  });
});

describe("refusedSentAt", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  it("reads FastField's time, with its offset or as UK time without one", () => {
    expect(refusedSentAt("2026-11-24T22:15:00.000+01:00", now).toISOString()).toBe("2026-11-24T21:15:00.000Z");
    expect(refusedSentAt("2026-11-24T22:15:00Z", now).toISOString()).toBe("2026-11-24T22:15:00.000Z");
    expect(refusedSentAt("2026-07-01T10:00:00", now).toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });
  it("falls back to now", () => {
    expect(refusedSentAt(null, now)).toBe(now);
    expect(refusedSentAt(undefined, now)).toBe(now);
    expect(refusedSentAt("not a time", now)).toBe(now);
  });
});

describe("recordRefusedReports", () => {
  const rec = (submissionId: string, over: Record<string, unknown> = {}) => ({
    submissionId,
    formId: 101,
    submittedAt: "2026-11-24T22:15:00Z",
    submittedBy: "Officer Ana Test",
    reason: "too_big" as const,
    ...over,
  });

  it("keeps a refused report set aside with its reason, and nothing of its contents", async () => {
    const s = await recordRefusedReports([rec("sub-1")]);
    expect(s).toEqual({ received: 1, recorded: 1, alreadyImported: 0, formOff: 0 });
    expect(db.fastFieldReport.create).toHaveBeenCalledTimes(1);
    const { data } = db.fastFieldReport.create.mock.calls[0][0];
    expect(data).toEqual({
      submissionId: "sub-1",
      formId: 101,
      submittedAt: new Date("2026-11-24T22:15:00Z"),
      submittedBy: "Officer Ana Test",
      status: "IGNORED",
      note: refusedNote("too_big"),
      rulesVersion: FASTFIELD_RULES_VERSION,
    });
    // No answers, photos, site or activity: the defaults ([] / null) apply.
    for (const k of ["answers", "photoUrls", "signatureUrl", "siteId", "jobId", "shiftId", "patrolVisitId"]) {
      expect(data).not.toHaveProperty(k);
    }
  });

  it("only for forms switched on, never over a report that's there, once per submission", async () => {
    db.fastFieldForm.findMany.mockResolvedValue([{ formId: 101 }]);
    db.fastFieldReport.findMany.mockResolvedValue([{ submissionId: "sub-there" }]);
    const s = await recordRefusedReports([
      rec("sub-new", { reason: "invalid" }),
      rec("sub-off", { formId: 202 }),
      rec("sub-there"),
      rec("sub-new"),
    ]);
    expect(s).toEqual({ received: 4, recorded: 1, alreadyImported: 2, formOff: 1 });
    expect(db.fastFieldForm.findMany.mock.calls[0][0].where).toEqual({
      formId: { in: [101, 202] },
      mode: "ON",
    });
    expect(db.fastFieldReport.create).toHaveBeenCalledTimes(1);
    expect(db.fastFieldReport.create.mock.calls[0][0].data.note).toBe(refusedNote("invalid"));
  });

  it("counts a clash with an overlapping run as already imported; other errors are thrown", async () => {
    db.fastFieldReport.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    expect(await recordRefusedReports([rec("sub-1")])).toEqual({
      received: 1,
      recorded: 0,
      alreadyImported: 1,
      formOff: 0,
    });
    db.fastFieldReport.create.mockRejectedValueOnce(new Error("connection lost"));
    await expect(recordRefusedReports([rec("sub-2")])).rejects.toThrow("connection lost");
  });

  it("does nothing for an empty list", async () => {
    expect(await recordRefusedReports([])).toEqual({ received: 0, recorded: 0, alreadyImported: 0, formOff: 0 });
    expect(db.fastFieldForm.findMany).not.toHaveBeenCalled();
  });
});
