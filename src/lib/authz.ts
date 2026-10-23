/**
 * Centralised role-based guards for server actions and API routes.
 *
 * Throws on unauthorised access — server actions auto-translate thrown
 * errors into a generic 500. For richer error reporting prefer returning
 * an ActionResult.fail() value instead.
 */
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CLIENT_PREVIEW_COOKIE, isUuid } from "@/lib/clientPreview";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /// Set when role = PARTNER (and future PARTNER_OFFICER). Carries
  /// through from the JWT — see auth.ts callbacks.
  partnerId: string | null;
  /// Set when role = CUSTOMER (client portal). Carries through from the JWT.
  customerId: string | null;
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
    customerId: session.user.customerId ?? null,
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

export type ClientScope = SessionUser & {
  /** The one customer every client-portal query is scoped to. */
  customerId: string;
  /** An admin previewing the dashboard (Admin → Customers → Preview). */
  preview: boolean;
};

/**
 * Who may see the client portal, and for which customer — or null. A
 * CUSTOMER login counts only while its user row is still active and on the
 * same customer (the session lasts 30 days, so a block must bite at once).
 * An ADMIN counts while previewing a customer.
 */
export async function getClientScope(): Promise<ClientScope | null> {
  const u = await getSessionUser();
  if (!u) return null;
  if (u.role === "ADMIN") {
    const id = cookies().get(CLIENT_PREVIEW_COOKIE)?.value ?? "";
    return isUuid(id) ? { ...u, customerId: id, preview: true } : null;
  }
  if (u.role !== "CUSTOMER" || !u.customerId) return null;
  const row = await prisma.user.findUnique({
    where: { id: u.id },
    select: { active: true, customerId: true },
  });
  if (!row?.active || row.customerId !== u.customerId) return null;
  return { ...u, customerId: u.customerId, preview: false };
}

/**
 * Client-portal guard. Used by every page under /client/*. Returns the
 * `customerId` callers MUST use to scope every query (through the
 * site: { is: { customerId } } relation for jobs/visits/shifts) — trusting
 * only the session, never the URL. Read-only portal. Without access it
 * sends the person to the client sign-in page.
 */
export async function requireCustomer(): Promise<ClientScope> {
  const scope = await getClientScope();
  if (!scope) redirect("/login/client");
  return scope;
}

/**
 * Partner-portal guard. Used by every server action / page under
 * /partner/* (the admin-side surface). Returns a guaranteed-non-null
 * `partnerId` that callers MUST use to scope every Prisma where
 * clause — trusting only the session, never the URL.
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

/**
 * Partner-officer mobile guard. Used by every server action / page
 * under /partner/m/*. On top of partnerId, returns the
 * partnerOfficerId of the roster row this login backs — every query
 * that filters assignments must scope by it so an officer only sees
 * THEIR jobs/shifts, not the whole partner's.
 *
 * Does one extra DB round-trip per call to look up the officer seat;
 * we don't put it on the JWT to avoid stale-link risk if the partner
 * admin re-links or deactivates.
 */
export async function requirePartnerOfficer(): Promise<
  SessionUser & { partnerId: string; partnerOfficerId: string }
> {
  const u = await requireUser();
  if (u.role !== "PARTNER_OFFICER") {
    throw new Error("Partner-officer access only");
  }
  if (!u.partnerId) {
    throw new Error("Partner-officer login not linked to a partner");
  }
  const { prisma } = await import("@/lib/db");
  const seat = await prisma.partnerOfficer.findUnique({
    where: { userId: u.id },
    select: { id: true, partnerId: true, active: true },
  });
  if (!seat) {
    throw new Error("Partner-officer roster row not found");
  }
  if (!seat.active) {
    throw new Error("Partner-officer is deactivated");
  }
  if (seat.partnerId !== u.partnerId) {
    // Defence: roster row was reparented since the JWT was issued.
    throw new Error("Partner-officer roster row mismatch");
  }
  return { ...u, partnerId: u.partnerId, partnerOfficerId: seat.id };
}
