/**
 * Shared Sites-list filtering + sorting, used by the /sites page and the
 * /api/sites/export route so the exported set always matches what's on screen.
 */
import type { Prisma } from "@prisma/client";

/** Sentinel value meaning "this relation is unset" (no region / owner). */
export const NONE_VALUE = "__none__";

export type SiteFilterParams = {
  q?: string;
  region?: string; // region NAME, or NONE_VALUE for "no region"
  service?: string;
  type?: string;
  partner?: string; // partnerId, or NONE_VALUE for "no partner"
  customer?: string; // customerId, or NONE_VALUE for "no customer"
  status?: string; // "active" (default) | "inactive" | "all"
};

export function buildSiteWhereAnd(
  p: SiteFilterParams,
): Prisma.SiteWhereInput[] {
  const and: Prisma.SiteWhereInput[] = [];

  if (p.q) {
    const q = p.q;
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { addressLine: { contains: q, mode: "insensitive" } },
        { postcode: { contains: q.replace(/\s+/g, ""), mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  if (p.region) {
    and.push(
      p.region === NONE_VALUE
        ? { regionId: null }
        : { region: { name: { equals: p.region, mode: "insensitive" } } },
    );
  }
  if (p.partner) {
    and.push(
      p.partner === NONE_VALUE ? { partnerId: null } : { partnerId: p.partner },
    );
  }
  if (p.customer) {
    and.push(
      p.customer === NONE_VALUE
        ? { customerId: null }
        : { customerId: p.customer },
    );
  }
  if (p.service) and.push({ services: { has: p.service as any } });
  if (p.type) and.push({ type: p.type as any });

  const status = p.status || "active";
  if (status === "active") and.push({ active: true });
  else if (status === "inactive") and.push({ active: false });
  // "all" → no active filter.

  return and;
}

export const SITE_SORTS = [
  { v: "code", label: "Code" },
  { v: "name", label: "Name" },
  { v: "region", label: "Region" },
  { v: "customer", label: "Customer" },
  { v: "partner", label: "Partner" },
  { v: "recent", label: "Newest first" },
] as const;

export function siteOrderBy(
  sort?: string,
): Prisma.SiteOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ name: "asc" }];
    case "region":
      return [{ region: { name: "asc" } }, { name: "asc" }];
    case "customer":
      return [{ customer: { name: "asc" } }, { name: "asc" }];
    case "partner":
      return [{ partner: { name: "asc" } }, { name: "asc" }];
    case "recent":
      return [{ createdAt: "desc" }];
    case "code":
    default:
      return [{ code: "asc" }, { name: "asc" }];
  }
}
