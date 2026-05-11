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
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
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
