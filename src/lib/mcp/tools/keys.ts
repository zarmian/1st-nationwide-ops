/**
 * Key register for the Claude connector (same data as /keys): where each key
 * is, who holds it, and its latest handover. Key codes are never stored on
 * keys, and site access codes (AccessInstruction) are never read.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { matchPeople, matchSites, siteLabel, ukIso, type ToolContext } from "./common";

export const KEY_STATUSES = ["WITH_US", "WITH_OFFICER", "WITH_CUSTOMER", "LOST", "RETIRED"] as const;

export async function findKeys(
  _ctx: ToolContext,
  input: {
    site?: string;
    holder?: string;
    status?: (typeof KEY_STATUSES)[number];
    query?: string;
    limit: number;
  },
) {
  const sites = input.site ? await matchSites(input.site) : null;
  const holderText = input.holder?.trim();
  const officeHeld = holderText && /^(office|1nw|us|none|nobody)$/i.test(holderText);
  const holders = holderText && !officeHeld ? await matchPeople(holderText) : null;
  const q = input.query?.trim();

  const where: Prisma.KeyWhereInput = {
    AND: [
      ...(sites ? [{ siteId: { in: sites.ids } }] : []),
      ...(officeHeld ? [{ currentHolderUserId: null }] : []),
      ...(holders ? [{ currentHolderUserId: { in: holders.ids } }] : []),
      ...(input.status ? [{ status: input.status }] : []),
      ...(q
        ? [
            {
              OR: [
                { label: { contains: q, mode: "insensitive" as const } },
                { internalNo: { contains: q, mode: "insensitive" as const } },
                { qrId: { contains: q, mode: "insensitive" as const } },
                { site: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            },
          ]
        : []),
    ],
  };

  const [count, byStatus, keys] = await Promise.all([
    prisma.key.count({ where }),
    prisma.key.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.key.findMany({
      where,
      orderBy: [{ site: { name: "asc" } }, { label: "asc" }],
      take: input.limit,
      select: {
        id: true,
        label: true,
        internalNo: true,
        type: true,
        status: true,
        notes: true,
        site: { select: { code: true, name: true } },
        keySet: { select: { label: true, internalNo: true } },
        currentHolder: { select: { name: true } },
        movements: {
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: {
            occurredAt: true,
            reason: true,
            fromUser: { select: { name: true } },
            toUser: { select: { name: true } },
            signedOffBy: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return {
    matchedSites: sites?.names,
    matchedHolders: holders?.names,
    count,
    byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
    shown: keys.length,
    keys: keys.map((k) => {
      const last = k.movements[0];
      return {
        id: k.id,
        label: k.label,
        ref: k.internalNo,
        type: k.type,
        status: k.status,
        site: k.site ? siteLabel(k.site) : null,
        keySet: k.keySet ? (k.keySet.internalNo ? `${k.keySet.label} (${k.keySet.internalNo})` : k.keySet.label) : null,
        holder: k.currentHolder?.name ?? (k.status === "WITH_US" ? "1NW office" : null),
        lastHandover: last
          ? {
              at: ukIso(last.occurredAt),
              from: last.fromUser?.name ?? "1NW office",
              to: last.toUser?.name ?? "1NW office",
              reason: last.reason,
              signedOffBy: last.signedOffBy?.name ?? null,
            }
          : null,
        notes: k.notes,
      };
    }),
  };
}
