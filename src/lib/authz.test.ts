import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRole } from "@prisma/client";

// The page guards read the session and call Next's redirect(), which throws
// to end the render. Stand both in: redirect throws a marker naming where
// it was sent.
const { getServerSession, redirect } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn((to: string): never => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("next/navigation", () => ({ redirect }));

import {
  homeForRole,
  pageRedirect,
  requireAdminPage,
  requireOfficerPage,
  requireStaffPage,
  type PageAccess,
} from "./authz";

const ROLES: UserRole[] = [
  "ADMIN",
  "DISPATCHER",
  "OFFICER",
  "PARTNER",
  "PARTNER_OFFICER",
  "CUSTOMER",
];

describe("homeForRole", () => {
  it("sends each role to its own home, as the middleware does", () => {
    expect(homeForRole("OFFICER")).toBe("/m/today");
    expect(homeForRole("DISPATCHER")).toBe("/dispatch");
    expect(homeForRole("ADMIN")).toBe("/dispatch");
    expect(homeForRole("PARTNER")).toBe("/partner");
    expect(homeForRole("PARTNER_OFFICER")).toBe("/partner/m/today");
    expect(homeForRole("CUSTOMER")).toBe("/client");
  });

  it("sends a role it doesn't know to sign in again", () => {
    expect(homeForRole("SUPERVISOR" as UserRole)).toBe("/login");
  });
});

describe("pageRedirect", () => {
  // Expected destination per role and kind of page; null = may open it.
  const table: Record<UserRole, Record<PageAccess, string | null>> = {
    ADMIN: { admin: null, staff: null, officer: null },
    DISPATCHER: { admin: "/dispatch", staff: null, officer: null },
    OFFICER: { admin: "/m/today", staff: "/m/today", officer: null },
    PARTNER: { admin: "/partner", staff: "/partner", officer: "/partner" },
    PARTNER_OFFICER: {
      admin: "/partner/m/today",
      staff: "/partner/m/today",
      officer: "/partner/m/today",
    },
    CUSTOMER: { admin: "/client", staff: "/client", officer: "/client" },
  };

  for (const role of ROLES) {
    for (const access of ["admin", "staff", "officer"] as const) {
      const want = table[role][access];
      it(`${role} on a ${access} page → ${want ?? "opens it"}`, () => {
        expect(pageRedirect(role, access)).toBe(want);
      });
    }
  }

  it("keeps admin pages from dispatchers but lets them review reports", () => {
    // /admin/officer-rates, /admin/customers, /admin/fastfield are admin
    // pages; the review queue /admin/reports is a staff page.
    expect(pageRedirect("DISPATCHER", "admin")).toBe("/dispatch");
    expect(pageRedirect("DISPATCHER", "staff")).toBeNull();
  });

  it("never sends anyone round in a loop", () => {
    // The staff-app pages that are someone's home, and their kind.
    const homes: Record<string, PageAccess> = {
      "/dispatch": "staff",
      "/m/today": "officer",
    };
    for (const role of ROLES) {
      const home = homeForRole(role);
      const kind = homes[home];
      if (kind) {
        // A home inside the staff app opens for its own role.
        expect(pageRedirect(role, kind)).toBeNull();
      } else {
        // Everyone else's home is outside the staff app (partner or
        // client portal), which these guards never check.
        expect(home).toMatch(/^\/(partner|client)(\/|$)/);
      }
    }
  });
});

describe("page guards", () => {
  const guards = {
    admin: requireAdminPage,
    staff: requireStaffPage,
    officer: requireOfficerPage,
  } as const;

  function signInAs(role: UserRole | null) {
    getServerSession.mockResolvedValue(
      role === null
        ? null
        : {
            user: {
              id: "user-1",
              email: "ana.test@example.com",
              name: "Officer Ana Test",
              role,
              partnerId: null,
              customerId: null,
            },
          },
    );
  }

  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
  });

  it("sends someone signed out to sign in", async () => {
    signInAs(null);
    for (const guard of Object.values(guards)) {
      await expect(guard()).rejects.toThrow("redirect:/login");
    }
  });

  it("sends a session with no role to sign in", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    await expect(requireStaffPage()).rejects.toThrow("redirect:/login");
  });

  for (const role of ROLES) {
    for (const access of ["admin", "staff", "officer"] as const) {
      const to = pageRedirect(role, access);
      it(`${access} guard: ${role} → ${to ?? "returns the user"}`, async () => {
        signInAs(role);
        if (to) {
          await expect(guards[access]()).rejects.toThrow(`redirect:${to}`);
        } else {
          await expect(guards[access]()).resolves.toMatchObject({
            id: "user-1",
            role,
          });
          expect(redirect).not.toHaveBeenCalled();
        }
      });
    }
  }

  it("matches the review's matrix", async () => {
    // OFFICER on staff pages (/keys, /officers, /shifts, /admin/reports/…)
    // and admin pages (/admin/officer-rates) lands on /m/today.
    signInAs("OFFICER");
    await expect(requireStaffPage()).rejects.toThrow("redirect:/m/today");
    await expect(requireAdminPage()).rejects.toThrow("redirect:/m/today");
    // DISPATCHER on admin pages lands on the dispatch board; staff pages open.
    signInAs("DISPATCHER");
    await expect(requireAdminPage()).rejects.toThrow("redirect:/dispatch");
    await expect(requireStaffPage()).resolves.toMatchObject({
      role: "DISPATCHER",
    });
    // An admin can open /m/today to see what an officer sees.
    signInAs("ADMIN");
    await expect(requireOfficerPage()).resolves.toMatchObject({
      role: "ADMIN",
    });
  });
});
