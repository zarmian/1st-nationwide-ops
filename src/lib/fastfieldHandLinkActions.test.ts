// The hand-link server actions (Admin → FastField → a report) check what
// they're sent before touching anything: ids must be uuids and the kind one
// of job / visit / shift — anything else is an error, never "a shift". The
// session, database and attach functions are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  logActivity: vi.fn(async () => {}),
  linkReportToJob: vi.fn(async () => ({ ok: true as const })),
  linkReportToVisit: vi.fn(async () => ({ ok: true as const })),
  linkReportToShift: vi.fn(async () => ({ ok: true as const })),
  createJobForReport: vi.fn(async () => ({ ok: true as const })),
  setReportIgnored: vi.fn(async () => ({ ok: true as const })),
  unlinkReportFromActivity: vi.fn(async () => ({ ok: true as const, check: ["The job is on invoice INV-1 — adjust the invoice."] })),
  reportFindUnique: vi.fn(async () => ({ status: "LINKED", shiftId: null as string | null, jobId: null as string | null, patrolVisitId: null as string | null })),
  siteFindUnique: vi.fn(async () => ({ name: "Riverside Storage" })),
  putBackFirstCheck: vi.fn(async () => ({ ok: true as const, mode: "move" as const, fromShiftId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })),
  leaveFirstCheck: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/authz", () => ({
  requireAdmin: async () => ({ id: "99999999-9999-4999-8999-999999999999", name: "Officer Ana Test", role: "ADMIN" }),
}));
vi.mock("@/lib/audit", () => ({ logActivity: m.logActivity }));
vi.mock("@/lib/db", () => ({
  prisma: {
    fastFieldReport: { findUnique: m.reportFindUnique },
    site: { findUnique: m.siteFindUnique },
  },
}));
vi.mock("@/lib/fastfieldImport", () => ({
  linkReportToJob: m.linkReportToJob,
  linkReportToVisit: m.linkReportToVisit,
  linkReportToShift: m.linkReportToShift,
  createJobForReport: m.createJobForReport,
  setReportIgnored: m.setReportIgnored,
  unlinkReportFromActivity: m.unlinkReportFromActivity,
  retryUnmatched: vi.fn(),
  skipPlace: vi.fn(),
  stopSkipping: vi.fn(),
}));
vi.mock("@/lib/fastfieldFirstCheck", () => ({
  putBackFirstCheck: m.putBackFirstCheck,
  leaveFirstCheck: m.leaveFirstCheck,
}));

import {
  createFastFieldJob,
  ignoreFastFieldReport,
  linkFastFieldReport,
  unlinkFastFieldReport,
} from "@/app/(app)/admin/fastfield/_actions";
import { leaveFirstCheckReport, putBackFirstCheckReport } from "@/app/(app)/admin/fastfield/_firstCheckActions";

const ME = "99999999-9999-4999-8999-999999999999";
const REPORT = "11111111-1111-4111-8111-111111111111";
const ACTIVITY = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkFastFieldReport", () => {
  it("refuses any kind but job, visit or shift — it isn't taken as a shift", async () => {
    for (const kind of ["bogus", "", "SHIFT", "jobs"]) {
      const res = await linkFastFieldReport(REPORT, kind as "shift", ACTIVITY);
      expect(res.ok).toBe(false);
    }
    expect(m.linkReportToShift).not.toHaveBeenCalled();
    expect(m.linkReportToJob).not.toHaveBeenCalled();
    expect(m.linkReportToVisit).not.toHaveBeenCalled();
  });

  it("refuses ids that aren't uuids", async () => {
    expect((await linkFastFieldReport("x", "job", ACTIVITY)).ok).toBe(false);
    expect((await linkFastFieldReport(REPORT, "job", "1; drop")).ok).toBe(false);
    expect(m.linkReportToJob).not.toHaveBeenCalled();
  });

  it("links by hand with the person's id, to the kind asked for", async () => {
    expect((await linkFastFieldReport(REPORT, "shift", ACTIVITY)).ok).toBe(true);
    expect(m.linkReportToShift).toHaveBeenCalledWith(REPORT, ACTIVITY, {
      note: "Linked by Officer Ana Test.",
      byHand: true,
      byUserId: ME,
    });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/shifts/${ACTIVITY}`);
    await linkFastFieldReport(REPORT, "job", ACTIVITY);
    expect(m.linkReportToJob).toHaveBeenCalledWith(REPORT, ACTIVITY, expect.objectContaining({ byHand: true, byUserId: ME }));
    await linkFastFieldReport(REPORT, "visit", ACTIVITY);
    expect(m.linkReportToVisit).toHaveBeenCalledWith(REPORT, ACTIVITY, expect.objectContaining({ byUserId: ME }));
  });

  it("passes the attach function's refusal on", async () => {
    m.linkReportToShift.mockResolvedValueOnce({ ok: false, error: "Shift not found." } as never);
    expect(await linkFastFieldReport(REPORT, "shift", ACTIVITY)).toEqual({ ok: false, error: "Shift not found." });
  });
});

describe("createFastFieldJob", () => {
  it("checks the ids and the kind of job", async () => {
    expect((await createFastFieldJob("x", SITE, "ALARM_RESPONSE")).ok).toBe(false);
    expect((await createFastFieldJob(REPORT, "x", "ALARM_RESPONSE")).ok).toBe(false);
    expect((await createFastFieldJob(REPORT, SITE, "STATIC_GUARDING_SHIFT")).ok).toBe(false);
    expect(m.createJobForReport).not.toHaveBeenCalled();
  });

  it("creates the job with the person's id", async () => {
    expect((await createFastFieldJob(REPORT, SITE, "LOCK")).ok).toBe(true);
    expect(m.createJobForReport).toHaveBeenCalledWith(REPORT, {
      siteId: SITE,
      type: "LOCK",
      note: "Job at Riverside Storage created by Officer Ana Test.",
      byUserId: ME,
    });
  });
});

describe("ignoreFastFieldReport", () => {
  it("checks the id", async () => {
    expect((await ignoreFastFieldReport("x", true)).ok).toBe(false);
    expect((await ignoreFastFieldReport(REPORT, "yes" as unknown as boolean)).ok).toBe(false);
    expect(m.setReportIgnored).not.toHaveBeenCalled();
  });

  it("sets aside and brings back with a true note, and writes the history", async () => {
    await ignoreFastFieldReport(REPORT, true);
    expect(m.setReportIgnored).toHaveBeenLastCalledWith(REPORT, true, "Set aside by Officer Ana Test.");
    expect(m.logActivity).toHaveBeenLastCalledWith({
      entity: "FastFieldReport",
      entityId: REPORT,
      action: "fastfield_set_aside",
      userId: ME,
    });
    await ignoreFastFieldReport(REPORT, false);
    expect(m.setReportIgnored).toHaveBeenLastCalledWith(REPORT, false, "Brought back by Officer Ana Test.");
    expect(m.logActivity).toHaveBeenLastCalledWith(expect.objectContaining({ action: "fastfield_brought_back" }));
  });
});

describe("unlinkFastFieldReport", () => {
  it("checks the id", async () => {
    expect((await unlinkFastFieldReport("x")).ok).toBe(false);
    expect(m.unlinkReportFromActivity).not.toHaveBeenCalled();
  });

  it("unlinks through unlinkReportFromActivity with the person's id and returns what to check", async () => {
    m.reportFindUnique.mockResolvedValueOnce({ status: "LINKED", shiftId: null, jobId: ACTIVITY, patrolVisitId: null });
    const res = await unlinkFastFieldReport(REPORT);
    expect(res).toEqual({ ok: true, data: { check: ["The job is on invoice INV-1 — adjust the invoice."] } });
    expect(m.unlinkReportFromActivity).toHaveBeenCalledWith(REPORT, "Officer Ana Test", { byUserId: ME });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/dispatch/${ACTIVITY}`);
    // A job's history is the unlink function's to write.
    expect(m.logActivity).not.toHaveBeenCalled();
  });

  it("writes the shift's history for a shift link, as before", async () => {
    m.reportFindUnique.mockResolvedValueOnce({ status: "LINKED", shiftId: ACTIVITY, jobId: null, patrolVisitId: null });
    m.unlinkReportFromActivity.mockResolvedValueOnce({ ok: true } as never);
    const res = await unlinkFastFieldReport(REPORT);
    expect(res).toEqual({ ok: true, data: { check: [] } });
    expect(m.logActivity).toHaveBeenCalledWith({
      entity: "Shift",
      entityId: ACTIVITY,
      action: "fastfield_unlinked",
      userId: ME,
      diff: { fastfieldReportId: REPORT },
    });
  });
});

describe("the first check's actions", () => {
  it("check the ids", async () => {
    expect((await putBackFirstCheckReport("x", ACTIVITY)).ok).toBe(false);
    expect((await putBackFirstCheckReport(REPORT, "x")).ok).toBe(false);
    expect((await leaveFirstCheckReport("x")).ok).toBe(false);
    expect(m.putBackFirstCheck).not.toHaveBeenCalled();
    expect(m.leaveFirstCheck).not.toHaveBeenCalled();
  });

  it("put back with the person, and refresh both shifts", async () => {
    expect((await putBackFirstCheckReport(REPORT, ACTIVITY)).ok).toBe(true);
    expect(m.putBackFirstCheck).toHaveBeenCalledWith(REPORT, ACTIVITY, { userId: ME, name: "Officer Ana Test" });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/shifts/${ACTIVITY}`);
    expect(m.revalidatePath).toHaveBeenCalledWith("/shifts/dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect((await leaveFirstCheckReport(REPORT)).ok).toBe(true);
    expect(m.leaveFirstCheck).toHaveBeenCalledWith(REPORT, ME);
  });
});
