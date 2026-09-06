"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  extractBonlineLegs,
  parseBonlineLeg,
  deriveCallFromLegs,
} from "@/lib/bonline";

export type CleanupResult = {
  ok: boolean;
  groups?: number;
  removed?: number;
  error?: string;
};

/**
 * Consolidate bOnline call rows that were stored before call-leg grouping —
 * regroup every row by its conversation, merge the legs, re-derive the outcome,
 * keep the earliest row and delete the duplicates. Safe to run repeatedly.
 */
export async function consolidateBonlineCalls(): Promise<CleanupResult> {
  await requireAdmin();

  const rows = await prisma.callEvent.findMany({
    where: { provider: "bonline" },
    orderBy: { createdAt: "asc" },
    select: { id: true, externalId: true, alerted: true, payload: true },
  });

  // Group rows by the conversation they belong to.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const legs = extractBonlineLegs(r.payload).map(parseBonlineLeg);
    const conv =
      legs.map((l) => l.conversationId).find((c): c is string => !!c) ??
      r.externalId ??
      r.id;
    const arr = groups.get(conv) ?? [];
    arr.push(r);
    groups.set(conv, arr);
  }

  let removed = 0;
  try {
    for (const [key, groupRows] of groups) {
      // Merge every leg from every row in the group (latest state per legId).
      const legMap: Record<string, unknown> = {};
      let alerted = false;
      for (const r of groupRows) {
        if (r.alerted) alerted = true;
        const raw = r.payload as { legs?: unknown } | null;
        const nested =
          raw?.legs && typeof raw.legs === "object" && !Array.isArray(raw.legs)
            ? (raw.legs as Record<string, unknown>)
            : null;
        if (nested) {
          Object.assign(legMap, nested);
        } else {
          const l = parseBonlineLeg(r.payload);
          const lk = l.legId ?? `leg-${Object.keys(legMap).length + 1}`;
          legMap[lk] = r.payload;
        }
      }

      const d = deriveCallFromLegs(
        Object.values(legMap).map(parseBonlineLeg),
      );
      const canonical = groupRows[0]; // earliest by createdAt

      await prisma.callEvent.update({
        where: { id: canonical.id },
        data: {
          externalId: key,
          direction: d.direction,
          status: d.status,
          fromNumber: d.fromNumber,
          toNumber: d.toNumber,
          durationSec: d.durationSec,
          missed: d.missed,
          occurredAt: d.occurredAt,
          alerted,
          payload: { legs: legMap } as any,
        },
      });

      const dupes = groupRows.slice(1).map((r) => r.id);
      if (dupes.length > 0) {
        await prisma.callEvent.deleteMany({ where: { id: { in: dupes } } });
        removed += dupes.length;
      }
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Clean-up failed." };
  }

  revalidatePath("/calls");
  return { ok: true, groups: groups.size, removed };
}
