/**
 * A lease lock on the `RunLock` table, so only one copy of a background run
 * works at a time (e.g. the FastField matcher, which the 5-minute cron, the
 * sync robot and the admin's "Try matching again" can all start at once).
 *
 * - Taking it is one atomic statement: insert the lock's row, or take it over
 *   when its lease has run out. Two runs racing for it can't both win.
 * - The lease is a time limit, not a connection: production talks to the
 *   database through PgBouncer in transaction mode, where Postgres advisory
 *   locks don't stay with a run. A run that crashes simply lets its lease run
 *   out, so make the lease longer than the run's time budget plus a margin.
 * - Letting go only clears the lock while this run still holds it (its random
 *   holder id), so a run that overran its lease can't free someone else's.
 * - Times come from the database's clock (UTC, like every DateTime Prisma
 *   stores), never the app server's.
 */
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

/** What the lock needs from Prisma (tests pass a stand-in). */
export type RunLockDb = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

/** The shortest lease taken, so a tiny budget can't make a lock that runs
 *  out before its first query returns. */
const MIN_LEASE_MS = 5_000;

/** Take the lock `name` for `leaseMs` as `holder`. False when another holder
 *  has it and its lease hasn't run out. */
export async function takeRunLock(
  name: string,
  leaseMs: number,
  holder: string,
  db: RunLockDb = prisma,
): Promise<boolean> {
  const lease = Math.max(MIN_LEASE_MS, Math.round(leaseMs));
  const rows = await db.$queryRaw<{ holder: string | null }[]>`
    INSERT INTO "RunLock" ("name", "lockedUntil", "holder", "updatedAt")
    VALUES (
      ${name},
      (now() AT TIME ZONE 'UTC') + ${lease} * interval '1 millisecond',
      ${holder},
      (now() AT TIME ZONE 'UTC')
    )
    ON CONFLICT ("name") DO UPDATE
      SET "lockedUntil" = EXCLUDED."lockedUntil",
          "holder" = EXCLUDED."holder",
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE "RunLock"."lockedUntil" IS NULL
         OR "RunLock"."lockedUntil" < (now() AT TIME ZONE 'UTC')
    RETURNING "holder"`;
  return rows.length === 1 && rows[0].holder === holder;
}

/** Let go of the lock, only if `holder` still has it. True when it did. */
export async function releaseRunLock(
  name: string,
  holder: string,
  db: RunLockDb = prisma,
): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE "RunLock"
    SET "lockedUntil" = NULL, "holder" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "name" = ${name} AND "holder" = ${holder}`;
  return n === 1;
}

export type RunLockResult<T> = { ok: true; value: T } | { ok: false; busy: true };

/**
 * Run `fn` holding the lock `name`, or don't run it at all and say `busy`
 * when another copy holds it. The lock is let go when `fn` finishes or
 * throws (the error is passed on).
 */
export async function withRunLock<T>(
  name: string,
  leaseMs: number,
  fn: () => Promise<T>,
  db: RunLockDb = prisma,
): Promise<RunLockResult<T>> {
  const holder = randomUUID();
  if (!(await takeRunLock(name, leaseMs, holder, db))) return { ok: false, busy: true };
  try {
    return { ok: true, value: await fn() };
  } finally {
    await releaseRunLock(name, holder, db).catch((e) =>
      // Not fatal: the lease runs out by itself.
      console.error(
        `Run lock "${name}" not let go:`,
        (e as { code?: string })?.code ?? (e as Error)?.name ?? "error",
      ),
    );
  }
}
