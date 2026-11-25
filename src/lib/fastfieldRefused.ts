/**
 * Reports the FastField import refused: too big (413), or with something in
 * them it couldn't read (400, code invalid_report). The robot
 * (scripts/fastfield-forms.mjs) sends each one back as "refused" — its
 * submission id, form, send time, FastField user and a reason; never its
 * answers — and we keep a small FastFieldReport for it: set aside (IGNORED),
 * no answers or photos, with a note saying why. So the office sees it on
 * Admin → FastField, and planFastField() counts it as already imported, so
 * the robot stops copying its photos again every run.
 *
 * It never matches anything by itself: set-aside reports aren't retried, and
 * it has no answers. To import such a report after a fix, delete its row and
 * run the robot over its date.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseFastFieldTime } from "@/lib/fastfield";
import { FASTFIELD_RULES_VERSION } from "@/lib/fastfieldRulesVersion";

export const REFUSED_REASONS = ["too_big", "invalid"] as const;
export type RefusedReason = (typeof REFUSED_REASONS)[number];

export type RefusedRecord = {
  submissionId: string;
  formId: number;
  /** FastField's send time as the robot read it (now when missing). */
  submittedAt?: string | null;
  submittedBy?: string | null;
  reason: RefusedReason;
};

export type RefusedSummary = {
  received: number;
  /** Kept as set-aside reports, with the reason. */
  recorded: number;
  /** Already in the app: imported meanwhile, or kept before. */
  alreadyImported: number;
  /** Not kept: its form isn't switched on (or isn't known). */
  formOff: number;
};

const NOTE: Record<RefusedReason, string> = {
  too_big:
    "Couldn't import this report from FastField: it was too big. Open it in FastField to read it. The robot won't try it again.",
  invalid:
    "Couldn't import this report from FastField: part of it couldn't be read. Open it in FastField to read it. The robot won't try it again.",
};

/** The note a refused report is kept with. */
export function refusedNote(reason: RefusedReason): string {
  return NOTE[reason];
}

/** The send time the robot read (a FastField time), else `now`. */
export function refusedSentAt(s: string | null | undefined, now: Date = new Date()): Date {
  const t = parseFastFieldTime(s) ?? (s ? new Date(s) : null);
  return t && Number.isFinite(t.getTime()) ? t : now;
}

/**
 * Keep each refused report as a set-aside FastFieldReport with its reason —
 * only for forms switched on (the robot only imports those), and never over
 * a report that's already there.
 */
export async function recordRefusedReports(records: RefusedRecord[]): Promise<RefusedSummary> {
  const summary: RefusedSummary = {
    received: records.length,
    recorded: 0,
    alreadyImported: 0,
    formOff: 0,
  };
  if (records.length === 0) return summary;

  const on = new Set(
    (
      await prisma.fastFieldForm.findMany({
        where: { formId: { in: Array.from(new Set(records.map((r) => r.formId))) }, mode: "ON" },
        select: { formId: true },
      })
    ).map((f) => f.formId),
  );
  const there = new Set(
    (
      await prisma.fastFieldReport.findMany({
        where: { submissionId: { in: records.map((r) => r.submissionId) } },
        select: { submissionId: true },
      })
    ).map((r) => r.submissionId),
  );

  for (const r of records) {
    if (there.has(r.submissionId)) {
      summary.alreadyImported++;
      continue;
    }
    there.add(r.submissionId);
    if (!on.has(r.formId)) {
      summary.formOff++;
      continue;
    }
    try {
      await prisma.fastFieldReport.create({
        data: {
          submissionId: r.submissionId,
          formId: r.formId,
          submittedAt: refusedSentAt(r.submittedAt),
          submittedBy: r.submittedBy ?? null,
          status: "IGNORED",
          note: refusedNote(r.reason),
          rulesVersion: FASTFIELD_RULES_VERSION,
        },
        select: { id: true },
      });
      summary.recorded++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        summary.alreadyImported++; // imported or kept by an overlapping run
        continue;
      }
      throw e;
    }
  }
  return summary;
}
