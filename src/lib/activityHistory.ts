import { prisma } from "@/lib/db";

export type HistoryEvent = {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: Date;
  changedFields: string[];
};

function changedFieldsOf(diff: unknown): string[] {
  if (!diff || typeof diff !== "object") return [];
  return Object.keys(diff as Record<string, unknown>);
}

/** Full change history for one activity, oldest → newest. */
export async function loadActivityHistory(
  entity: string,
  entityId: string,
): Promise<HistoryEvent[]> {
  const rows = await prisma.activityLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      action: true,
      createdAt: true,
      diff: true,
      user: { select: { name: true, email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.user?.name || r.user?.email || null,
    createdAt: r.createdAt,
    changedFields: changedFieldsOf(r.diff),
  }));
}

export type LatestActor = { action: string; actorName: string | null; at: Date };

/**
 * The most-recent event for each of many activities, keyed "entity:id".
 * One query; rows are read newest-first so the first hit per key wins.
 */
export async function loadLatestActors(
  refs: { entity: string; entityId: string }[],
): Promise<Map<string, LatestActor>> {
  const byEntity = new Map<string, string[]>();
  for (const r of refs) {
    const list = byEntity.get(r.entity) ?? [];
    list.push(r.entityId);
    byEntity.set(r.entity, list);
  }
  const or = Array.from(byEntity.entries()).map(([entity, ids]) => ({
    entity,
    entityId: { in: ids },
  }));
  const out = new Map<string, LatestActor>();
  if (or.length === 0) return out;
  const rows = await prisma.activityLog.findMany({
    where: { OR: or },
    orderBy: { createdAt: "desc" },
    select: {
      entity: true,
      entityId: true,
      action: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  for (const r of rows) {
    const key = `${r.entity}:${r.entityId}`;
    if (out.has(key)) continue; // desc order → first seen is the latest
    out.set(key, {
      action: r.action,
      actorName: r.user?.name || r.user?.email || null,
      at: r.createdAt,
    });
  }
  return out;
}
