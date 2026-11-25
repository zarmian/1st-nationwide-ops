import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn(async () => []);
const sessionUser = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionUser: () => sessionUser() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    site: { findMany },
    user: { findMany },
    job: { findMany },
    shift: { findMany },
  },
}));

const { GET } = await import("./route");

function ask() {
  return GET(new Request("http://localhost/api/search?q=riverside"));
}

describe("GET /api/search", () => {
  beforeEach(() => {
    findMany.mockClear();
    sessionUser.mockReset();
  });

  it("asks a signed-out caller to sign in", async () => {
    sessionUser.mockResolvedValue(null);
    expect((await ask()).status).toBe(401);
  });

  for (const role of ["OFFICER", "PARTNER", "PARTNER_OFFICER", "CUSTOMER"]) {
    it(`gives a ${role} nothing, without touching the database`, async () => {
      sessionUser.mockResolvedValue({ id: "u1", role });
      const res = await ask();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sites: [], officers: [], jobs: [], shifts: [] });
      expect(findMany).not.toHaveBeenCalled();
    });
  }

  for (const role of ["ADMIN", "DISPATCHER"]) {
    it(`searches for ${role === "ADMIN" ? "an admin" : "a dispatcher"}`, async () => {
      sessionUser.mockResolvedValue({ id: "u1", role });
      const res = await ask();
      expect(res.status).toBe(200);
      expect(findMany).toHaveBeenCalled();
    });
  }
});
