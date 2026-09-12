/**
 * Duplicate patrol-visit cleanup — shared by the daily patrol-visits cron
 * (automatic) and the admin "Clean up duplicates" button (on demand).
 *
 * A duplicate is more than one non-cancelled visit for the same site, exact
 * scheduled time and kind — the artefact of the old schedule-churn bug. We keep
 * one visit per slot and cancel the extras, only ever cancelling PENDING visits
 * (never actioned/completed work), preferring to keep an actioned or a
 * schedule-linked visit. Safe to run repeatedly.
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit";

export type DedupeResult = { groups: number; cancelled: number };

export async function dedupePatrolVisits(opts?: {
  cancelledByUserId?: string | null;
}): Promise<DedupeResult> {
  const cancelledByUserId = opts?.cancelledByUserId ?? null;

  // Bound the scan to recent + future visits; older history isn't worth
  // rewriting and the duplicates that matter are upcoming.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const visits = await prisma.patrolVisit.findMany({
    where: { status: { not: "CANCELLED" }, scheduledAt: { gte: since } },
    select: {
      id: true,
      siteId: true,
      scheduledAt: true,
      status: true,
      patrolScheduleId: true,
      patrolSchedule: { select: { kind: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by site + exact time + kind (a detached visit has no schedule, so
  // assume PATROL — the common case behind the churn bug).
  const groups = new Map<string, typeof visits>();
  for (const v of visits) {
    const kind = v.patrolSchedule?.kind ?? "PATROL";
    const key = `${v.siteId}|${v.scheduledAt.toISOString()}|${kind}`;
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  }

  const toCancel: string[] = [];
  let dupGroups = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    dupGroups++;
    // Keep one: an actioned visit if any (never cancel real work), else a
    // schedule-linked PENDING, else the earliest (arr is createdAt-ascending).
    const actioned = arr.filter((v) => v.status !== "PENDING");
    const keeperId =
      actioned.length > 0
        ? actioned[0].id
        : (arr.find((v) => v.patrolScheduleId !== null) ?? arr[0]).id;
    for (const v of arr) {
      if (v.id === keeperId) continue;
      if (v.status !== "PENDING") continue; // never cancel actioned work
      toCancel.push(v.id);
    }
  }

  for (const id of toCancel) {
    await prisma.patrolVisit.update({
      where: { id },
      data: {
        status: "CANCELLED" as any,
        cancelledAt: new Date(),
        cancelledByUserId,
        statusBeforeCancel: "PENDING" as any,
        billedAmount: null,
        billedCurrency: null,
        billedAt: null,
        paidAmount: null,
        paidCurrency: null,
        paidAt: null,
      },
    });
    await logActivity({
      entity: "PatrolVisit",
      entityId: id,
      action: "cancelled",
      userId: cancelledByUserId ?? undefined,
      diff: {
        reason: cancelledByUserId
          ? "duplicate patrol removed"
          : "duplicate patrol removed (automatic)",
      } as any,
    });
  }

  return { groups: dupGroups, cancelled: toCancel.length };
}
