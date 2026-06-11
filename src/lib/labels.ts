import { prisma } from "@/lib/db";

/**
 * Admin-managed labels for the JobType and JobSource enums.
 *
 * The enums are still the DB-level storage primitive — Job.type and
 * Job.source haven't changed. These helpers just wrap a lookup against
 * the JobTypeOption / JobSourceOption tables (managed at /admin/options).
 *
 * Picker dropdowns use `listJobTypeOptions()` / `listJobSourceOptions()`
 * to render only the active rows in sortOrder.
 *
 * Display surfaces (dispatch table, public job board, etc.) use
 * `getJobTypeLabels()` / `getJobSourceLabels()` to resolve a code to its
 * display label. If no option exists for a code, we fall back to a
 * humanised version of the code so a fresh DB still reads OK.
 */

export const JOB_TYPE_CODES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "SURVEY",
  "VPI",
  "ADHOC",
  "STATIC_GUARDING_SHIFT",
  "DOG_HANDLER_SHIFT",
] as const;
export type JobTypeCode = (typeof JOB_TYPE_CODES)[number];

export const JOB_SOURCE_CODES = [
  "SCHEDULED",
  "ALARM",
  "PARTNER_REQUEST",
  "CUSTOMER_REQUEST",
  "ONBOARDING",
  "AD_HOC",
] as const;
export type JobSourceCode = (typeof JOB_SOURCE_CODES)[number];

/** Sensible defaults when no option row exists yet (fresh DB, pre-seed). */
const JOB_TYPE_DEFAULTS: Record<JobTypeCode, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Mobile patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "Void property inspection",
  ADHOC: "Ad-hoc / other",
  STATIC_GUARDING_SHIFT: "Static guarding shift",
  DOG_HANDLER_SHIFT: "Dog handler shift",
};

const JOB_SOURCE_DEFAULTS: Record<JobSourceCode, string> = {
  SCHEDULED: "Scheduled",
  ALARM: "Alarm activation",
  PARTNER_REQUEST: "Partner request",
  CUSTOMER_REQUEST: "Customer request",
  ONBOARDING: "Onboarding",
  AD_HOC: "Ad-hoc",
};

export type OptionRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

export async function listJobTypeOptions(opts?: {
  includeInactive?: boolean;
}): Promise<OptionRow[]> {
  return prisma.jobTypeOption.findMany({
    where: opts?.includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      description: true,
      sortOrder: true,
      active: true,
    },
  });
}

export async function listJobSourceOptions(opts?: {
  includeInactive?: boolean;
}): Promise<OptionRow[]> {
  return prisma.jobSourceOption.findMany({
    where: opts?.includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      description: true,
      sortOrder: true,
      active: true,
    },
  });
}

/**
 * Resolve each JobType code to its display label. The first active option
 * by sortOrder wins; codes with no option fall back to a humanised default.
 */
export async function getJobTypeLabels(): Promise<Record<string, string>> {
  const opts = await listJobTypeOptions();
  return buildLabelMap(opts, JOB_TYPE_DEFAULTS);
}

export async function getJobSourceLabels(): Promise<Record<string, string>> {
  const opts = await listJobSourceOptions();
  return buildLabelMap(opts, JOB_SOURCE_DEFAULTS);
}

function buildLabelMap(
  opts: OptionRow[],
  defaults: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = { ...defaults };
  // Group active options by code. If exactly one option exists for a code
  // we treat it as an admin rename and use its label as the display
  // label. If multiple options exist (e.g. "Alarm response" plus
  // sub-types like "Customer unable to exit"), those are picker-only
  // aliases — don't let them hijack the display label across activity
  // lists, dispatch board, public job pages, etc. Fall back to the
  // canonical default in that case.
  const byCode = new Map<string, OptionRow[]>();
  for (const o of opts) {
    const list = byCode.get(o.code);
    if (list) list.push(o);
    else byCode.set(o.code, [o]);
  }
  for (const [code, rows] of byCode) {
    if (rows.length === 1) {
      map[code] = rows[0]!.label;
    }
  }
  return map;
}

/**
 * Idempotent seed: makes sure every enum code has at least one option
 * row, using the JOB_TYPE_DEFAULTS / JOB_SOURCE_DEFAULTS labels. Safe to
 * re-run — only creates rows for codes with no existing option.
 *
 * Called from the admin Options page on first load so a fresh DB
 * gets a sensible starting set without manual SQL.
 */
export async function ensureOptionsSeeded(): Promise<{
  jobTypesCreated: number;
  jobSourcesCreated: number;
}> {
  const [existingTypes, existingSources] = await Promise.all([
    prisma.jobTypeOption.findMany({ select: { code: true } }),
    prisma.jobSourceOption.findMany({ select: { code: true } }),
  ]);
  const existingTypeCodes = new Set(existingTypes.map((o) => o.code));
  const existingSourceCodes = new Set(existingSources.map((o) => o.code));

  let jobTypesCreated = 0;
  let jobSourcesCreated = 0;

  for (let i = 0; i < JOB_TYPE_CODES.length; i++) {
    const code = JOB_TYPE_CODES[i]!;
    if (existingTypeCodes.has(code)) continue;
    await prisma.jobTypeOption.create({
      data: {
        code: code as any,
        label: JOB_TYPE_DEFAULTS[code],
        sortOrder: (i + 1) * 10,
        active: true,
      },
    });
    jobTypesCreated++;
  }

  for (let i = 0; i < JOB_SOURCE_CODES.length; i++) {
    const code = JOB_SOURCE_CODES[i]!;
    if (existingSourceCodes.has(code)) continue;
    await prisma.jobSourceOption.create({
      data: {
        code: code as any,
        label: JOB_SOURCE_DEFAULTS[code],
        sortOrder: (i + 1) * 10,
        active: true,
      },
    });
    jobSourcesCreated++;
  }

  return { jobTypesCreated, jobSourcesCreated };
}
