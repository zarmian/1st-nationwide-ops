/**
 * Centralised role-based guards for server actions and API routes.
 *
 * Throws on unauthorised access — server actions auto-translate thrown
 * errors into a generic 500. For richer error reporting prefer returning
 * an ActionResult.fail() value instead.
 */
import { getServerSession } from "next-auth";
import type { UserRole } from "@prisma/client";
import { authOptions } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /// Set when role = PARTNER (and future PARTNER_OFFICER). Carries
  /// through from the JWT — see auth.ts callbacks.
  partnerId: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
    partnerId: session.user.partnerId ?? null,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Sign in required");
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "ADMIN") {
    throw new Error("Not authorised");
  }
  return u;
}

export async function requireStaff(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "ADMIN" && u.role !== "DISPATCHER") {
    throw new Error("Not authorised");
  }
  return u;
}

/**
 * Partner-portal guard. Used by every server action / page under
 * /partner/*. Returns a guaranteed-non-null `partnerId` that callers
 * MUST use to scope every Prisma where clause — trusting only the
 * session, never the URL.
 */
export async function requirePartner(): Promise<
  SessionUser & { partnerId: string }
> {
  const u = await requireUser();
  if (u.role !== "PARTNER") {
    throw new Error("Partner-portal access only");
  }
  if (!u.partnerId) {
    // Should be impossible if the admin-side login form requires a
    // partnerId, but throw rather than silently leaking data scope.
    throw new Error("Partner login is not linked to a partner");
  }
  return { ...u, partnerId: u.partnerId };
}
