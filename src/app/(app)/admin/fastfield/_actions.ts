"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { fail, ok, okVoid, type ActionResult } from "@/lib/actionResult";
import { logActivity } from "@/lib/audit";
import {
  createJobForReport,
  linkReportToJob,
  linkReportToVisit,
  retryUnmatched,
  setReportIgnored,
} from "@/lib/fastfieldImport";

/** Job types a FastField form can create when nothing matches. */
const CREATE_TYPES = ["ALARM_RESPONSE", "ADHOC", "LOCK", "UNLOCK", "KEY_COLLECTION", "VPI"] as const;

const FormSettings = z.object({
  formId: z.coerce.number().int().positive(),
  customerId: z.string().uuid().or(z.literal("")),
  enabled: z.boolean(),
  createJobs: z.boolean(),
  jobType: z.enum(CREATE_TYPES),
});

function refresh(reportId?: string) {
  revalidatePath("/admin/fastfield");
  if (reportId) revalidatePath(`/admin/fastfield/${reportId}`);
  revalidatePath("/dispatch");
  revalidatePath("/activities");
}

/** Which client a FastField form reports for, and whether it's imported. */
export async function saveFastFieldForm(input: {
  formId: number;
  customerId: string;
  enabled: boolean;
  createJobs: boolean;
  jobType: string;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const parsed = FormSettings.safeParse(input);
  if (!parsed.success) return fail("Those settings don't look right.");
  const d = parsed.data;
  if (d.enabled && !d.customerId) {
    return fail("Pick the client this form is for before switching it on.");
  }
  const form = await prisma.fastFieldForm.findUnique({
    where: { formId: d.formId },
    select: { formId: true },
  });
  if (!form) return fail("That form no longer exists.");
  await prisma.fastFieldForm.update({
    where: { formId: d.formId },
    data: {
      customerId: d.customerId || null,
      enabled: d.enabled,
      createJobs: d.createJobs,
      jobType: d.jobType as JobType,
    },
  });
  await logActivity({
    entity: "FastFieldForm",
    entityId: String(d.formId),
    action: d.enabled ? "import on" : "import off",
    userId: me.id,
  }).catch(() => {});
  refresh();
  return okVoid();
}

/** Attach a report to a job or patrol visit picked by hand. */
export async function linkFastFieldReport(
  reportId: string,
  kind: "job" | "visit",
  activityId: string,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const note = `Linked by ${me.name || "the office"}.`;
  const res =
    kind === "job"
      ? await linkReportToJob(reportId, activityId, { note })
      : await linkReportToVisit(reportId, activityId, { note });
  if (!res.ok) return fail(res.error);
  refresh(reportId);
  return okVoid();
}

/** Create the job a report describes, at a site picked by hand. */
export async function createFastFieldJob(
  reportId: string,
  siteId: string,
  type: string,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const t = z.enum(CREATE_TYPES).safeParse(type);
  if (!t.success) return fail("Pick the kind of job to create.");
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { name: true } });
  if (!site) return fail("Pick the site first.");
  const res = await createJobForReport(reportId, {
    siteId,
    type: t.data as JobType,
    note: `Job at ${site.name} created by ${me.name || "the office"}.`,
  });
  if (!res.ok) return fail(res.error);
  refresh(reportId);
  return okVoid();
}

/** Set a report aside (a test, a duplicate) or bring it back. */
export async function ignoreFastFieldReport(
  reportId: string,
  ignored: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const res = await setReportIgnored(
    reportId,
    ignored,
    ignored ? `Set aside by ${me.name || "the office"}.` : undefined,
  );
  if (!res.ok) return fail(res.error);
  refresh(reportId);
  return okVoid();
}

/** Re-run matching on the unmatched reports from the last 60 days. */
export async function retryFastFieldMatching(): Promise<
  ActionResult<{ linked: number; created: number; left: number }>
> {
  await requireAdmin();
  const s = await retryUnmatched({ sinceDays: 60, limit: 300 });
  refresh();
  const left = s.unmatched.site + s.unmatched.none + s.unmatched.taken + s.unmatched.ambiguous;
  return ok({ linked: s.linked, created: s.created, left });
}
