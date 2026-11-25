/**
 * Pure helpers for Admin → FastField's list page and the tools around it:
 * waiting reports grouped by place from database counts, what a skipped
 * place's report does when it comes back, the "taken off a shift" line, the
 * "Try matching again" message, and which jobs made from a report were made
 * by a person. No database access here — the queries are in fastfieldImport.ts.
 */
import { siteKey, type PlaceGroup } from "@/lib/fastfield";

// ── Waiting, by place ─────────────────────────────────────────────────────

/** One row of a database group-by over waiting reports: how many were typed
 *  exactly like this and matched to this site, and when the latest was sent. */
export type PlaceCount = {
  siteText: string | null;
  siteName: string | null;
  count: number;
  latest: Date;
};

type Tally = { n: number; last: number };

function add(m: Map<string, Tally>, key: string, n: number, last: number) {
  const t = m.get(key) ?? { n: 0, last: 0 };
  t.n += n;
  t.last = Math.max(t.last, last);
  m.set(key, t);
}

/** The key seen most often, the latest on a tie (then the first by name, so
 *  the answer never depends on the order the database returned the rows in). */
function most(m: Map<string, Tally>): string | null {
  let best: string | null = null;
  let bestTally: Tally = { n: -1, last: -1 };
  for (const [k, t] of m) {
    if (
      t.n > bestTally.n ||
      (t.n === bestTally.n && (t.last > bestTally.last || (t.last === bestTally.last && best !== null && k < best)))
    ) {
      best = k;
      bestTally = t;
    }
  }
  return best;
}

/**
 * Waiting reports grouped by the place typed (siteKey), from group-by counts
 * rather than one row per report: the same groups and order as groupByPlace()
 * in fastfield.ts. Biggest group first, then the most recent; the label is the
 * spelling typed most often and the site the one most of them were matched to
 * (each the latest on a tie). Rows with no site typed are left out.
 */
export function placesFromCounts(rows: PlaceCount[]): PlaceGroup[] {
  const groups = new Map<
    string,
    { spellings: Map<string, Tally>; sites: Map<string, Tally>; count: number; latest: Date }
  >();
  for (const r of rows) {
    const key = siteKey(r.siteText);
    if (!key || r.count <= 0) continue;
    const g = groups.get(key) ?? { spellings: new Map(), sites: new Map(), count: 0, latest: r.latest };
    const last = r.latest.getTime();
    add(g.spellings, r.siteText!.trim().replace(/\s+/g, " "), r.count, last);
    if (r.siteName) add(g.sites, r.siteName, r.count, last);
    g.count += r.count;
    if (r.latest > g.latest) g.latest = r.latest;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: most(g.spellings) ?? key,
      count: g.count,
      siteName: most(g.sites),
      latest: g.latest,
    }))
    .sort((a, b) => b.count - a.count || b.latest.getTime() - a.latest.getTime());
}

// ── On a shift, outside its time ──────────────────────────────────────────

/**
 * The answer types a report's time can be read from. `answerKind()` in
 * fastfield.ts only reads a time from an answer whose type says date or time,
 * so the outside-its-time list loads just these (as a database regex) instead
 * of every answer, photo list and note of hundreds of reports.
 */
export const TIME_ANSWER_TYPES = /date|time/i;

// ── Stop skipping: what each report does next ─────────────────────────────

/**
 * What a set-aside report does when its place stops being skipped. Who took
 * it off a shift decides (`unlinkedAt` / `unlinkedBy`): one a person took off
 * waits for a person; one the robot took off may only be put back by the
 * robot onto a shift it fits (never a job or visit); any other report the
 * robot tries again as usual.
 */
export type ComeBack = "robot_tries" | "robot_puts_back" | "waits_for_you";

/** The note a report gets when its place stops being skipped. */
export function broughtBackNote(by: string, how: ComeBack): string {
  switch (how) {
    case "robot_tries":
      return `Brought back by ${by}. The robot tries it again.`;
    case "robot_puts_back":
      // Keeps the words "by the robot:", which older put-back code looked for.
      return `Brought back by ${by}. It was taken off a shift by the robot: the robot puts it back on a shift there that it fits, otherwise it waits for you.`;
    case "waits_for_you":
      return `Brought back by ${by}. It was taken off a shift by a person, so it waits for you: link it or set it aside.`;
  }
}

// ── Needs linking: reports taken off a shift ──────────────────────────────

/** "3 of them were taken off a shift: 2 by a person and 1 by the robot — each
 *  says why." Null when none were. */
export function takenOffText(byPerson: number, byRobot: number): string | null {
  const total = byPerson + byRobot;
  if (total <= 0) return null;
  const parts = [
    ...(byPerson > 0 ? [`${byPerson} by a person`] : []),
    ...(byRobot > 0 ? [`${byRobot} by the robot`] : []),
  ];
  return `${total} of them ${total === 1 ? "was" : "were"} taken off a shift: ${parts.join(" and ")} — ${
    total === 1 ? "it says" : "each says"
  } why.`;
}

// ── Try matching again ────────────────────────────────────────────────────

/** The message after "Try matching again". */
export function retryMessage(s: {
  attached: number;
  checked: number;
  notReached: number;
  busy?: boolean;
}): { tone: "info" | "success"; message: string } {
  if (s.busy) return { tone: "info", message: "The robot is matching right now — try again in a minute." };
  const more =
    s.notReached > 0 ? ` Checked ${s.checked} — press again to check the other ${s.notReached}.` : "";
  return s.attached > 0
    ? { tone: "success", message: `Attached ${s.attached} report${s.attached === 1 ? "" : "s"}.${more}` }
    : { tone: "info", message: `Nothing new matched.${more}` };
}

// ── The connector's review: jobs made by hand ─────────────────────────────

/**
 * Whether the job made from a report (status CREATED) was made by a person:
 * its `fastfield_created` history line names who made it (no one for the
 * robot). Jobs made before that history existed have no line; for those the
 * note tells ("Job at … created by <name>.").
 */
export function createdByHand(
  report: { note: string | null },
  history: { userId: string | null }[] | undefined,
): boolean {
  if (history && history.length > 0) return history.some((h) => h.userId != null);
  return (report.note ?? "").includes(" created by ");
}
