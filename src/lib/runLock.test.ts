import { describe, it, expect, vi } from "vitest";
import { releaseRunLock, takeRunLock, withRunLock, type RunLockDb } from "./runLock";

/**
 * A stand-in for the RunLock table that behaves like the two statements:
 * take = insert, or take over a row whose lease ran out; release = clear the
 * row only for its holder. `clock` is the database's clock (ms).
 */
function fakeDb() {
  const clock = { now: Date.parse("2026-11-25T02:00:00Z") };
  const rows = new Map<string, { lockedUntil: number | null; holder: string | null }>();
  const sql: string[] = [];
  const db = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join("?"));
      const [name, lease, holder] = values as [string, number, string];
      const row = rows.get(name);
      if (!row || row.lockedUntil == null || row.lockedUntil < clock.now) {
        rows.set(name, { lockedUntil: clock.now + lease, holder });
        return [{ holder }];
      }
      return [];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join("?"));
      const [name, holder] = values as [string, string];
      const row = rows.get(name);
      if (row && row.holder === holder) {
        row.lockedUntil = null;
        row.holder = null;
        return 1;
      }
      return 0;
    },
  };
  return { db: db as unknown as RunLockDb, rows, clock, sql };
}

describe("takeRunLock / releaseRunLock", () => {
  it("takes the lock in one statement that only wins while no live lease is held", async () => {
    const { db, sql } = fakeDb();
    await takeRunLock("matcher", 60_000, "a", db);
    const take = sql[0];
    expect(take).toMatch(/INSERT INTO "RunLock"/);
    expect(take).toMatch(/ON CONFLICT \("name"\) DO UPDATE/);
    expect(take).toMatch(/WHERE "RunLock"\."lockedUntil" IS NULL\s+OR "RunLock"\."lockedUntil" < \(now\(\) AT TIME ZONE 'UTC'\)/);
    expect(take).toMatch(/RETURNING "holder"/);
    // updatedAt has no database default: the insert must set it.
    expect(take).toMatch(/"updatedAt"\)\s+VALUES/);
  });

  it("refuses a second holder while the lease lasts, and lets one in once it runs out", async () => {
    const { db, clock } = fakeDb();
    expect(await takeRunLock("matcher", 60_000, "a", db)).toBe(true);
    expect(await takeRunLock("matcher", 60_000, "b", db)).toBe(false);
    clock.now += 59_000;
    expect(await takeRunLock("matcher", 60_000, "b", db)).toBe(false);
    clock.now += 2_000; // a crashed run's lease has run out
    expect(await takeRunLock("matcher", 60_000, "b", db)).toBe(true);
  });

  it("keeps separate locks apart", async () => {
    const { db } = fakeDb();
    expect(await takeRunLock("one", 60_000, "a", db)).toBe(true);
    expect(await takeRunLock("two", 60_000, "b", db)).toBe(true);
  });

  it("never takes a lease shorter than a few seconds", async () => {
    const { db, rows, clock } = fakeDb();
    await takeRunLock("matcher", 10, "a", db);
    expect(rows.get("matcher")!.lockedUntil! - clock.now).toBe(5_000);
  });

  it("lets go only for the holder", async () => {
    const { db } = fakeDb();
    await takeRunLock("matcher", 60_000, "a", db);
    expect(await releaseRunLock("matcher", "b", db)).toBe(false);
    expect(await takeRunLock("matcher", 60_000, "b", db)).toBe(false);
    expect(await releaseRunLock("matcher", "a", db)).toBe(true);
    expect(await takeRunLock("matcher", 60_000, "b", db)).toBe(true);
  });

  it("can't free a lock someone else took over after this run's lease ran out", async () => {
    const { db, clock } = fakeDb();
    await takeRunLock("matcher", 60_000, "slow", db);
    clock.now += 61_000;
    await takeRunLock("matcher", 60_000, "next", db);
    expect(await releaseRunLock("matcher", "slow", db)).toBe(false);
    expect(await takeRunLock("matcher", 60_000, "third", db)).toBe(false);
  });
});

describe("withRunLock", () => {
  it("runs the work and lets go afterwards", async () => {
    const { db, rows } = fakeDb();
    const res = await withRunLock("matcher", 60_000, async () => 42, db);
    expect(res).toEqual({ ok: true, value: 42 });
    expect(rows.get("matcher")).toEqual({ lockedUntil: null, holder: null });
  });

  it("says busy without running the work while another copy holds it", async () => {
    const { db } = fakeDb();
    let release!: () => void;
    const first = withRunLock(
      "matcher",
      60_000,
      () => new Promise<string>((r) => (release = () => r("first"))),
      db,
    );
    await new Promise((r) => setTimeout(r, 0));
    const work = vi.fn(async () => "second");
    expect(await withRunLock("matcher", 60_000, work, db)).toEqual({ ok: false, busy: true });
    expect(work).not.toHaveBeenCalled();
    release();
    expect(await first).toEqual({ ok: true, value: "first" });
    // Free again once the first is done.
    expect(await withRunLock("matcher", 60_000, work, db)).toEqual({ ok: true, value: "second" });
  });

  it("lets go when the work throws, and passes the error on", async () => {
    const { db, rows } = fakeDb();
    await expect(
      withRunLock("matcher", 60_000, async () => {
        throw new Error("boom");
      }, db),
    ).rejects.toThrow("boom");
    expect(rows.get("matcher")!.holder).toBeNull();
  });

  it("still returns the work's result when letting go fails (the lease runs out by itself)", async () => {
    const { db } = fakeDb();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    (db as unknown as { $executeRaw: () => Promise<number> }).$executeRaw = async () => {
      throw Object.assign(new Error("connection lost: secret detail"), { code: "P1001" });
    };
    expect(await withRunLock("matcher", 60_000, async () => "done", db)).toEqual({ ok: true, value: "done" });
    // Only the error's code is logged, never its message.
    expect(err).toHaveBeenCalledWith(expect.stringContaining("matcher"), "P1001");
    err.mockRestore();
  });
});
