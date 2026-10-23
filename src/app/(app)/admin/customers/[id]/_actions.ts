"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { logActivity } from "@/lib/audit";
import { parseDomains } from "@/lib/clientLogin";
import { CLIENT_PREVIEW_COOKIE, CLIENT_PREVIEW_MAX_AGE_S } from "@/lib/clientPreview";

/**
 * Admin side of the client dashboard (/client): which email domains may sign
 * in with an emailed link, who has, and a preview of what the client sees.
 */

export type ClientDomainsState = { error?: string; success?: string };

export async function saveClientDomains(
  customerId: string,
  _prev: ClientDomainsState,
  formData: FormData,
): Promise<ClientDomainsState> {
  const me = await requireAdmin();
  const { domains, invalid } = parseDomains(String(formData.get("domains") ?? ""));
  if (invalid.length) {
    return { error: `Not a valid domain: ${invalid.join(", ")}. Use the part after the @, like shurgard.co.uk.` };
  }
  if (domains.length > 10) return { error: "At most 10 domains." };

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { portalEmailDomains: true },
  });
  if (!customer) return { error: "Customer not found." };

  // A domain belongs to one customer, or an email would match two dashboards.
  const clash = await prisma.customer.findFirst({
    where: { id: { not: customerId }, portalEmailDomains: { hasSome: domains } },
    select: { name: true, portalEmailDomains: true },
  });
  if (clash) {
    const shared = domains.filter((d) => clash.portalEmailDomains.includes(d));
    return { error: `${shared.join(", ")} is already used by ${clash.name}.` };
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: { portalEmailDomains: domains },
  });
  await logActivity({
    entity: "Customer",
    entityId: customerId,
    action: "client_dashboard_domains",
    userId: me.id,
    diff: { portalEmailDomains: { from: customer.portalEmailDomains, to: domains } },
  });
  revalidatePath(`/admin/customers/${customerId}/edit`);
  return {
    success: domains.length
      ? "Saved. People at these domains can now sign in."
      : "Saved. Email sign-in is off for this customer.",
  };
}

/** Block or unblock one client login. A block takes effect on their next
 *  page, even mid-session. */
export async function setClientUserActive(
  customerId: string,
  userId: string,
  active: boolean,
): Promise<void> {
  const me = await requireAdmin();
  const res = await prisma.user.updateMany({
    where: { id: userId, customerId, role: "CUSTOMER" },
    data: { active },
  });
  if (res.count === 1) {
    await logActivity({
      entity: "User",
      entityId: userId,
      action: active ? "client_login_unblocked" : "client_login_blocked",
      userId: me.id,
    });
  }
  revalidatePath(`/admin/customers/${customerId}/edit`);
}

/** See the client dashboard exactly as this customer would. */
export async function startClientPreview(customerId: string): Promise<void> {
  await requireAdmin();
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) return;
  cookies().set(CLIENT_PREVIEW_COOKIE, customer.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CLIENT_PREVIEW_MAX_AGE_S,
  });
  redirect("/client");
}
