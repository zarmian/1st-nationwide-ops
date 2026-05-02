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
  "tri",
  "location",
  "section",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

// `section` is a non-input divider — only label is meaningful.
const SECTION_KEY = /^section_\d+$/;

export const FieldDefSchema = z
  .object({
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
  })
  .superRefine((f, ctx) => {
    if (f.type === "section") {
      // Sections only need a label; key is auto-generated, required is ignored.
      return;
    }
  });

export type FieldDef = z.infer<typeof FieldDefSchema>;

export const FieldsArraySchema = z
  .array(FieldDefSchema)
  .max(40)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const [i, f] of fields.entries()) {
      if (f.type !== "section") {
        if (seen.has(f.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "key"],
            message: "Field keys must be unique",
          });
        }
        seen.add(f.key);
      }
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
  jobType: SubmissionFormType | null;
  scope: "SITE" | "CUSTOMER" | "PARTNER" | "GLOBAL";
  fields: FieldDef[];
};

/**
 * Resolve which template applies for a (site, jobType) pair.
 * Order: SITE → CUSTOMER → PARTNER → GLOBAL. Within a scope, an exact jobType
 * match beats an "any job type" (jobType=null) template. First active hit wins.
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

  const candidates = await prisma.formTemplate.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ jobType: jobType as any }, { jobType: null }] },
        {
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
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  const scopeOrder: Record<string, number> = {
    SITE: 0,
    CUSTOMER: 1,
    PARTNER: 2,
    GLOBAL: 3,
  };
  candidates.sort((a, b) => {
    const s = (scopeOrder[a.scope] ?? 99) - (scopeOrder[b.scope] ?? 99);
    if (s !== 0) return s;
    // Exact jobType match wins over null (any).
    const aExact = a.jobType === (jobType as any) ? 0 : 1;
    const bExact = b.jobType === (jobType as any) ? 0 : 1;
    return aExact - bExact;
  });
  const winner = candidates[0];
  if (!winner) return null;

  const fields = parseFields(winner.fields);
  return {
    id: winner.id,
    name: winner.name,
    jobType: winner.jobType as SubmissionFormType | null,
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

const LocationSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
  accuracy: z.number().finite().optional().nullable(),
  capturedAt: z.string().optional().nullable(),
});

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
    if (f.type === "section") continue;

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
      case "tri": {
        const n = Number(v);
        if (![0, 1, 2].includes(n)) {
          errors[f.key] = `${f.label} must be Yes, No, or N/A`;
          break;
        }
        out[f.key] = n;
        break;
      }
      case "location": {
        const parsed = LocationSchema.safeParse(v);
        if (!parsed.success) {
          errors[f.key] = `${f.label} must be a valid GPS location`;
          break;
        }
        out[f.key] = parsed.data;
        break;
      }
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

// Tri-state encoding: 0 = No, 1 = Yes, 2 = N/A.
export const TRI_LABELS: Record<number, string> = {
  0: "No",
  1: "Yes",
  2: "N/A",
};
