/**
 * Sites for the Claude connector: search (same filters as /sites) and a site
 * profile. The profile deliberately never touches AccessInstruction — alarm,
 * padlock and lockbox codes and entry steps stay out of Claude entirely.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildSiteWhereAnd } from "@/lib/siteFilters";
import { siteHiddenAnd } from "@/lib/hiddenAccounts";
import { loadActivities } from "./activities";
import {
  ToolInputError,
  isUuid,
  matchCustomers,
  matchPartners,
  siteLabel,
  ukDate,
  ukDayOffset,
  ukToday,
  type ToolContext,
} from "./common";
import { parseIsoDate } from "@/lib/dates";

export const SERVICE_TAGS = [
  "ALARM_RESPONSE",
  "KEYHOLDING",
  "LOCKUP",
  "UNLOCK",
  "VPI",
  "PATROL",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
] as const;

export async function searchSites(
  ctx: ToolContext,
  input: {
    query?: string;
    customer?: string;
    partner?: string;
    region?: string;
    service?: (typeof SERVICE_TAGS)[number];
    status?: "active" | "inactive" | "all";
    limit: number;
  },
) {
  const customers = input.customer ? await matchCustomers(input.customer) : null;
  const partners = input.partner ? await matchPartners(input.partner) : null;
  const where: Prisma.SiteWhereInput = {
    AND: [
      ...buildSiteWhereAnd({
        q: input.query?.trim() || undefined,
        region: input.region?.trim() || undefined,
        service: input.service,
        status: input.status ?? "active",
      }),
      ...(customers ? [{ customerId: { in: customers.ids } }] : []),
      ...(partners ? [{ partnerId: { in: partners.ids } }] : []),
      ...siteHiddenAnd(ctx.hidden),
    ],
  };
  const [count, sites] = await Promise.all([
    prisma.site.count({ where }),
    prisma.site.findMany({
      where,
      orderBy: [{ code: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      take: input.limit,
      select: {
        id: true,
        code: true,
        name: true,
        addressLine: true,
        city: true,
        postcodeFormatted: true,
        type: true,
        services: true,
        riskLevel: true,
        dne: true,
        hsMarkers: true,
        active: true,
        region: { select: { name: true } },
        customer: { select: { name: true } },
        partner: { select: { name: true } },
      },
    }),
  ]);
  return {
    matchedCustomers: customers?.names,
    matchedPartners: partners?.names,
    count,
    shown: sites.length,
    sites: sites.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      address: [s.addressLine, s.city, s.postcodeFormatted].filter(Boolean).join(", "),
      region: s.region?.name ?? null,
      customer: s.customer?.name ?? null,
      partner: s.partner?.name ?? null,
      type: s.type,
      services: s.services,
      riskLevel: s.riskLevel,
      flags: [...(s.dne ? ["DO NOT ENGAGE"] : []), ...(s.hsMarkers ? ["Health & safety markers"] : [])],
      active: s.active,
    })),
  };
}

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export async function getSite(ctx: ToolContext, input: { site: string }) {
  const text = input.site.trim();
  if (!text) throw new ToolInputError("Say which site: its code, name, postcode or id.");

  let siteId: string | null = null;
  if (isUuid(text)) {
    siteId = text;
  } else {
    const byCode = await prisma.site.findFirst({
      where: { code: { equals: text, mode: "insensitive" } },
      select: { id: true },
    });
    if (byCode) {
      siteId = byCode.id;
    } else {
      const candidates = await prisma.site.findMany({
        where: {
          AND: [
            {
              OR: [
                { name: { contains: text, mode: "insensitive" } },
                { postcode: { contains: text.replace(/\s+/g, ""), mode: "insensitive" } },
                { addressLine: { contains: text, mode: "insensitive" } },
              ],
            },
            ...siteHiddenAnd(ctx.hidden),
          ],
        },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        take: 11,
        select: { id: true, code: true, name: true, postcodeFormatted: true, active: true },
      });
      const exact = candidates.filter((c) => c.name.toLowerCase() === text.toLowerCase());
      if (exact.length === 1) siteId = exact[0].id;
      else if (candidates.length === 1) siteId = candidates[0].id;
      else if (candidates.length === 0) {
        throw new ToolInputError(`No site matches "${text}". Try search_sites with part of the name or postcode.`);
      } else {
        return {
          ambiguous: true,
          message: `Several sites match "${text}". Ask again with one of these codes or ids.`,
          candidates: candidates.slice(0, 10).map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            postcode: c.postcodeFormatted,
            active: c.active,
          })),
          more: candidates.length > 10,
        };
      }
    }
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId! },
    select: {
      id: true,
      code: true,
      name: true,
      addressLine: true,
      city: true,
      postcodeFormatted: true,
      lat: true,
      lng: true,
      what3words: true,
      geofenceRadiusM: true,
      type: true,
      services: true,
      riskLevel: true,
      dne: true,
      hsMarkers: true,
      notes: true,
      active: true,
      partnerReference: true,
      partnerSin: true,
      startDate: true,
      terminationDate: true,
      region: { select: { name: true } },
      customer: {
        select: {
          name: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          contacts: {
            orderBy: { name: "asc" },
            select: { name: true, role: true, phone: true, email: true },
          },
        },
      },
      partner: { select: { name: true } },
      defaultResponder: { select: { name: true } },
      patrolSchedules: {
        where: { active: true },
        select: {
          kind: true,
          dayOfWeek: true,
          frequency: true,
          intervalWeeks: true,
          timeOfDay: true,
          timesOfDay: true,
          startsOn: true,
          endsOn: true,
          assignedOfficer: { select: { name: true } },
          handledByPartner: { select: { name: true } },
        },
      },
      lockUnlockSchedules: {
        where: { active: true },
        select: {
          unlockTime: true,
          lockdownTime: true,
          days: true,
          assignedOfficer: { select: { name: true } },
        },
      },
      keySets: {
        where: { active: true },
        orderBy: { label: "asc" },
        select: {
          label: true,
          internalNo: true,
          keys: {
            select: { label: true, type: true, status: true, currentHolder: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!site) throw new ToolInputError(`No site with id ${siteId}.`);

  const today = ukToday(ctx.now);
  const [recent, upcoming] = await Promise.all([
    loadActivities(ctx, {
      from: parseIsoDate(ukDayOffset(ctx.now, -14))!,
      to: parseIsoDate(today, true)!,
      siteIds: [site.id],
      limit: 200,
    }),
    loadActivities(ctx, {
      from: parseIsoDate(ukDayOffset(ctx.now, 1))!,
      to: parseIsoDate(ukDayOffset(ctx.now, 7), true)!,
      siteIds: [site.id],
      limit: 15,
    }),
  ]);

  const contacts = site.customer
    ? site.customer.contacts.length
      ? site.customer.contacts
      : site.customer.contactName || site.customer.contactPhone || site.customer.contactEmail
        ? [
            {
              name: site.customer.contactName,
              role: null,
              phone: site.customer.contactPhone,
              email: site.customer.contactEmail,
            },
          ]
        : []
    : [];

  return {
    id: site.id,
    code: site.code,
    name: site.name,
    address: [site.addressLine, site.city, site.postcodeFormatted].filter(Boolean).join(", "),
    what3words: site.what3words,
    hasMapPosition: site.lat != null && site.lng != null,
    geofenceMetres: site.geofenceRadiusM ?? 300,
    active: site.active,
    type: site.type,
    region: site.region?.name ?? null,
    customer: site.customer?.name ?? null,
    customerContacts: contacts,
    partner: site.partner?.name ?? null,
    partnerReference: site.partnerReference,
    partnerSin: site.partnerSin,
    defaultResponder: site.defaultResponder?.name ?? null,
    services: site.services,
    riskLevel: site.riskLevel,
    flags: [
      ...(site.dne ? ["DO NOT ENGAGE"] : []),
      ...(site.hsMarkers ? ["Health & safety markers"] : []),
    ],
    notes: site.notes,
    contract: { start: ukDate(site.startDate), termination: ukDate(site.terminationDate) },
    patrolSchedules: site.patrolSchedules
      .sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek))
      .map((p) => ({
        kind: p.kind,
        day: p.dayOfWeek,
        frequency: p.intervalWeeks ? `every ${p.intervalWeeks} weeks` : p.frequency,
        times: p.timesOfDay.length ? p.timesOfDay : p.timeOfDay ? [p.timeOfDay] : [],
        from: ukDate(p.startsOn),
        until: ukDate(p.endsOn),
        officer: p.assignedOfficer?.name ?? null,
        subcontractedTo: p.handledByPartner?.name ?? null,
      })),
    lockUnlockSchedules: site.lockUnlockSchedules.map((l) => ({
      unlock: l.unlockTime,
      lock: l.lockdownTime,
      days: l.days,
      officer: l.assignedOfficer?.name ?? null,
    })),
    keySets: site.keySets.map((k) => ({
      label: k.label,
      ref: k.internalNo,
      keys: k.keys.map((key) => ({
        label: key.label,
        type: key.type,
        status: key.status,
        holder: key.currentHolder?.name ?? null,
      })),
    })),
    last14Days: recent.totals,
    recentActivity: recent.rows.slice(-10).reverse(),
    next7Days: upcoming.rows,
    note: "Alarm, padlock and lockbox codes and entry steps are never shared through Claude.",
  };
}
