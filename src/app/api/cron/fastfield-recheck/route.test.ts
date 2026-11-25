import { describe, it, expect, vi, beforeEach } from "vitest";

const checkShiftLinks = vi.fn();
const retryUnmatched = vi.fn();
vi.mock("@/lib/fastfieldImport", () => ({
  checkShiftLinks: (...a: unknown[]) => checkShiftLinks(...a),
  retryUnmatched: (...a: unknown[]) => retryUnmatched(...a),
}));
vi.mock("@/lib/cronAuth", () => ({ isAuthorisedCron: () => true }));

import { GET } from "./route";

const shiftSummary = {
  checked: 3,
  fit: 2,
  moved: 1,
  takenOff: 0,
  kept: 0,
  putBack: 0,
  released: 0,
  more: false,
};
const retrySummary = {
  received: 4,
  checked: 4,
  notReached: 0,
  linked: 1,
  created: 0,
  failed: 0,
  alreadyImported: 0,
  formOff: 0,
  skipped: 0,
  linkedByType: {},
  unmatched: { site: 0, none: 3, taken: 0, ambiguous: 0, shift: 0 },
  byForm: {},
};
const req = () => new Request("http://localhost/api/cron/fastfield-recheck");

describe("GET /api/cron/fastfield-recheck", () => {
  beforeEach(() => {
    checkShiftLinks.mockReset();
    retryUnmatched.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs the shift check, then the retry", async () => {
    checkShiftLinks.mockResolvedValue(shiftSummary);
    retryUnmatched.mockResolvedValue(retrySummary);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, shiftCheck: shiftSummary, checked: 4, linked: 1 });
    expect(body.errors).toBeUndefined();
  });

  it("still retries waiting reports when the shift check throws, and gives only its error code", async () => {
    checkShiftLinks.mockRejectedValue(
      Object.assign(new Error("relation does not exist: secret details"), { code: "P2010" }),
    );
    retryUnmatched.mockResolvedValue(retrySummary);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(retryUnmatched).toHaveBeenCalled();
    expect(body).toMatchObject({ ok: true, shiftCheck: null, checked: 4, errors: { shiftCheck: "P2010" } });
    expect(JSON.stringify(body)).not.toContain("secret details");
  });

  it("keeps the shift check's result when the retry throws", async () => {
    checkShiftLinks.mockResolvedValue(shiftSummary);
    retryUnmatched.mockRejectedValue(new TypeError("boom"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, shiftCheck: shiftSummary, errors: { retry: "TypeError" } });
  });

  it("fails (500) only when both steps throw", async () => {
    checkShiftLinks.mockRejectedValue(Object.assign(new Error("x"), { code: "P1001" }));
    retryUnmatched.mockRejectedValue(Object.assign(new Error("y"), { code: "P1001" }));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, errors: { shiftCheck: "P1001", retry: "P1001" } });
  });

  it("passes on that the matcher was busy", async () => {
    checkShiftLinks.mockResolvedValue({ ...shiftSummary, checked: 0, busy: true });
    retryUnmatched.mockResolvedValue({ ...retrySummary, checked: 0, busy: true });
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ ok: true, busy: true, shiftCheck: { busy: true } });
  });
});
