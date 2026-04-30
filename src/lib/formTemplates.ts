import { z } from "zod";
import { prisma } from "@/lib/db";

export const FIELD_TYPES = [
  "text",
  "textarea",
  "checkbox",
  "select",
  "number",
  "date",
  "time",
  "datetime",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FieldDefSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, underscores"),
  label: z.string().trim().min(1, "Label is required").max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).optional(),
  helpText: z.string().trim().max(500).optional().nullable(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional().nullable(),
});

export type FieldDef = z.infer<typeof FieldDefSchema>;

export const FieldsArraySchema = z
  .array(FieldDefSchema)
  .max(40)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const [i, f] of fields.entries()) {
      if (seen.has(f.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "key"],
          message: "Field keys must be unique",
        });
      }
      seen.add(f.key);
      if (f.type === "select" && (!f.options || f.options.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "options"],
          message: "Select fields need at least one option",
        });
      }
    }
  });

const SUBMISSION_FORMS = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "VPI",
  "ADHOC",
] as const;

export const SUBMISSION_FORM_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Mobile patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  VPI: "Void property inspection",
  ADHOC: "Ad-hoc / other",
};

export type SubmissionFormType = (typeof SUBMISSION_FORMS)[number];

export type ResolvedTemplate = {
  id: string;
  name: string;
  jobType: SubmissionFormType;
  scope: "SITE" | "CUSTOMER" | "PARTNER" | "GLOBAL";
  fields: FieldDef[];
};

/**
 * Resolve which template applies for a (site, jobType) pair.
 * Order: SITE → CUSTOMER → PARTNER → GLOBAL. First active hit wins.
 * Returns null if no template is configured anywhere.
 */
export async function resolveTemplate(
  siteId: string | null,
  jobType: SubmissionFormType,
): Promise<ResolvedTemplate | null> {
  let customerId: string | null = null;
  let partnerId: string | null = null;
  if (siteId) {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { customerId: true, partnerId: true },
    });
    customerId = site?.customerId ?? null;
    partnerId = site?.partnerId ?? null;
  }

  // Most specific first: site, then customer, then partner, then global.
  const candidates = await prisma.formTemplate.findMany({
    where: {
      jobType: jobType as any,
      active: true,
      OR: [
        siteId ? { scope: "SITE" as any, siteId } : { id: "_never_" as any },
        customerId
          ? { scope: "CUSTOMER" as any, customerId }
          : { id: "_never_" as any },
        partnerId
          ? { scope: "PARTNER" as any, partnerId }
          : { id: "_never_" as any },
        { scope: "GLOBAL" as any },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  const order: Record<string, number> = {
    SITE: 0,
    CUSTOMER: 1,
    PARTNER: 2,
    GLOBAL: 3,
  };
  candidates.sort(
    (a, b) => (order[a.scope] ?? 99) - (order[b.scope] ?? 99),
  );
  const winner = candidates[0];
  if (!winner) return null;

  const fields = parseFields(winner.fields);
  return {
    id: winner.id,
    name: winner.name,
    jobType: winner.jobType as SubmissionFormType,
    scope: winner.scope,
    fields,
  };
}

export function parseFields(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldDef[] = [];
  for (const f of raw) {
    const parsed = FieldDefSchema.safeParse(f);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Validate a submitted payload against a template's field definitions.
 * Returns either { ok: true, payload } with coerced values, or { ok: false, errors }.
 */
export function validatePayload(
  fields: FieldDef[],
  payload: Record<string, unknown>,
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> } {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const f of fields) {
    const v = payload[f.key];
    const isEmpty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (f.required && isEmpty && f.type !== "checkbox") {
      errors[f.key] = `${f.label} is required`;
      continue;
    }

    if (isEmpty) {
      out[f.key] = f.type === "checkbox" ? false : null;
      continue;
    }

    switch (f.type) {
      case "checkbox":
        out[f.key] = Boolean(v);
        break;
      case "number": {
        const n = Number(v);
        if (Number.isNaN(n)) {
          errors[f.key] = `${f.label} must be a number`;
          break;
        }
        out[f.key] = n;
        break;
      }
      case "select":
        if (f.options && !f.options.includes(String(v))) {
          errors[f.key] = `${f.label} value not in options`;
          break;
        }
        out[f.key] = String(v);
        break;
      case "text":
      case "textarea":
      case "date":
      case "time":
      case "datetime":
        out[f.key] = String(v).trim();
        break;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, payload: out };
}
