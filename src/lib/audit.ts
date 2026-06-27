/**
 * Lightweight per-entity audit trail, backed by the ActivityLog table.
 *
 * Used for the "anything edited after the job is done shows in the log, with
 * who edited it and when" requirement on shifts. Each call writes one row:
 *   entity   — model name, e.g. "Shift"
 *   entityId — the row id
 *   action   — short verb, e.g. "edited", "ended", "link_sent"
 *   diff     — optional structured before/after (see diffFields)
 *   userId   — who did it (null for token/officer actions with no account)
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type FieldChange = { from: unknown; to: unknown };

/**
 * Build a { field: { from, to } } object containing only the keys that
 * actually changed between two shallow records. Dates are compared by
 * timestamp; everything else by strict-ish (JSON) equality.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = (after as Record<string, unknown>)[key];
    if (!isEqual(a, b)) out[key] = { from: norm(a), to: norm(b) };
  }
  return out;
}

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : a;
    const bt = b instanceof Date ? b.getTime() : b;
    return at === bt;
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function logActivity(args: {
  entity: string;
  entityId: string;
  action: string;
  userId?: string | null;
  diff?: Record<string, FieldChange> | Prisma.InputJsonValue | null;
  /** Pass a transaction client to log inside the same tx as the change. */
  client?: Prisma.TransactionClient;
}): Promise<void> {
  const db = args.client ?? prisma;
  await db.activityLog.create({
    data: {
      entity: args.entity,
      entityId: args.entityId,
      action: args.action,
      userId: args.userId ?? null,
      diff:
        args.diff == null
          ? undefined
          : (args.diff as Prisma.InputJsonValue),
    },
  });
}
