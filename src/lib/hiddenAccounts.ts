/**
 * Admin-only "hidden accounts" filter.
 *
 * When an admin marks a customer/partner as hidden, that account and its
 * activities drop out of the browse/log surfaces admins view. This is a VIEW
 * declutter, gated to `role === "ADMIN"` — dispatchers, officers, the live
 * dispatch board, finance totals and the client portal are never filtered.
 *
 * Scope of "related activities" (deliberate): a hidden account's own sites and
 * their work, plus jobs directly tagged to the account (Job.customerId /
 * Job.partnerId). Work merely SUBCONTRACTED to a hidden partner
 * (handledByPartnerId) is NOT hidden — it belongs to the (visible) customer
 * whose site it happened on.
 *
 * The where-fragments are null-safe: a nullable FK that is null passes the
 * filter (only rows that positively belong to a hidden account are excluded).
 */
import { prisma } from "@/lib/db";

export type HiddenScope = {
  /** True only when admin AND at least one account is hidden. */
  active: boolean;
  customerIds: string[];
  partnerIds: string[];
  /** Sites owned by the hidden customers/partners. */
  siteIds: string[];
};

const EMPTY: HiddenScope = {
  active: false,
  customerIds: [],
  partnerIds: [],
  siteIds: [],
};

/**
 * Resolve the set of hidden accounts + their sites. Returns an inert scope
 * (no filtering) for non-admins, or when nothing is hidden.
 */
export async function loadHiddenScope(isAdmin: boolean): Promise<HiddenScope> {
  if (!isAdmin) return EMPTY;

  const [customers, partners] = await Promise.all([
    prisma.customer.findMany({ where: { hidden: true }, select: { id: true } }),
    prisma.partner.findMany({ where: { hidden: true }, select: { id: true } }),
  ]);
  const customerIds = customers.map((c) => c.id);
  const partnerIds = partners.map((p) => p.id);
  if (!customerIds.length && !partnerIds.length) return EMPTY;

  const sites = await prisma.site.findMany({
    where: {
      OR: [
        ...(customerIds.length ? [{ customerId: { in: customerIds } }] : []),
        ...(partnerIds.length ? [{ partnerId: { in: partnerIds } }] : []),
      ],
    },
    select: { id: true },
  });

  return { active: true, customerIds, partnerIds, siteIds: sites.map((s) => s.id) };
}

/** Null-safe "field is not in ids" (a null field passes). */
function notInOrNull(field: string, ids: string[]): any {
  return { OR: [{ [field]: null }, { [field]: { notIn: ids } }] };
}

/**
 * AND-fragments excluding jobs that belong to a hidden account — via the site,
 * or a direct Job.customerId / Job.partnerId link. Spread into a job `where`'s
 * AND array (safe alongside the query's own OR / other keys).
 */
export function jobHiddenAnd(scope: HiddenScope): any[] {
  if (!scope.active) return [];
  const out: any[] = [];
  if (scope.siteIds.length) out.push(notInOrNull("siteId", scope.siteIds));
  if (scope.customerIds.length) out.push(notInOrNull("customerId", scope.customerIds));
  if (scope.partnerIds.length) out.push(notInOrNull("partnerId", scope.partnerIds));
  return out;
}

/**
 * AND-fragments excluding rows on a hidden account's site — for PatrolVisit /
 * Shift / AlarmEvent / FormSubmission (they reach the account only via `site`).
 */
export function siteRefHiddenAnd(scope: HiddenScope): any[] {
  if (!scope.active || !scope.siteIds.length) return [];
  return [notInOrNull("siteId", scope.siteIds)];
}

/** AND-fragments excluding a hidden account's sites from a Site query. */
export function siteHiddenAnd(scope: HiddenScope): any[] {
  if (!scope.active || !scope.siteIds.length) return [];
  return [{ id: { notIn: scope.siteIds } }]; // Site.id is never null
}

/** Set of hidden site ids, for filtering an already-loaded array in memory. */
export function hiddenSiteSet(scope: HiddenScope): Set<string> {
  return new Set(scope.active ? scope.siteIds : []);
}
