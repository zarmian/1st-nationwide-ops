/**
 * Customer and partner directory for the Claude connector (admin-only, like
 * /admin/customers and /admin/partners). Hidden accounts are listed with a
 * flag, as on those pages.
 */
import { prisma } from "@/lib/db";
import { ukDate, type ToolContext } from "./common";

export async function listAccounts(
  _ctx: ToolContext,
  input: { kind?: "customers" | "partners" | "both"; name?: string; includeInactive?: boolean },
) {
  const kind = input.kind ?? "both";
  const name = input.name?.trim();
  const nameWhere = name ? { name: { contains: name, mode: "insensitive" as const } } : {};
  const activeWhere = input.includeInactive ? {} : { active: true };

  const [customers, partners] = await Promise.all([
    kind === "partners"
      ? []
      : prisma.customer.findMany({
          where: { ...nameWhere, ...activeWhere },
          orderBy: { name: "asc" },
          take: 200,
          select: {
            id: true,
            name: true,
            type: true,
            active: true,
            hidden: true,
            contractRef: true,
            contractStart: true,
            contractEnd: true,
            dailyReportOn: true,
            contactName: true,
            contactPhone: true,
            contactEmail: true,
            contacts: { orderBy: { name: "asc" }, select: { name: true, role: true, phone: true, email: true } },
            _count: { select: { sites: true } },
          },
        }),
    kind === "customers"
      ? []
      : prisma.partner.findMany({
          where: { ...nameWhere, ...activeWhere },
          orderBy: { name: "asc" },
          take: 200,
          select: {
            id: true,
            name: true,
            role: true,
            preferred: true,
            active: true,
            hidden: true,
            notes: true,
            contacts: { orderBy: { name: "asc" }, select: { name: true, role: true, phone: true, email: true } },
            _count: { select: { sites: true } },
          },
        }),
  ]);

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      active: c.active,
      hidden: c.hidden,
      sites: c._count.sites,
      contract: { ref: c.contractRef, start: ukDate(c.contractStart), end: ukDate(c.contractEnd) },
      dailyReportEmail: c.dailyReportOn,
      contacts: c.contacts.length
        ? c.contacts
        : c.contactName || c.contactPhone || c.contactEmail
          ? [{ name: c.contactName, role: null, phone: c.contactPhone, email: c.contactEmail }]
          : [],
    })),
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      relationship:
        p.role === "BOTH"
          ? "works for us and we work for them"
          : p.role === "SUBCONTRACTOR"
            ? "subcontractor (works for us)"
            : "customer (we work for them)",
      preferredChannel: p.preferred,
      active: p.active,
      hidden: p.hidden,
      sites: p._count.sites,
      notes: p.notes,
      contacts: p.contacts,
    })),
  };
}
