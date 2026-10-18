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
  linkReportToShift,
  linkReportToVisit,
  retryUnmatched,
  setReportIgnored,
} from "@/lib/fastfieldImport";

/** What a FastField form can report — and the job made when nothing matches. */
const REPORT_TYPES = ["ALARM_RESPONSE", "PATROL", "LOCK", "UNLOCK", "KEY_COLLECTION", "VPI", "ADHOC"] as const;

const FormSettings = z.object({
  formId: z.coerce.number().int().positive(),
  mode: z.enum(["OFF", "PREVIEW", "ON"]),
  jobType: z.enum(REPORT_TYPES),
  customerId: z.string().uuid().or(z.literal("")),
  createCustomerId: z.string().uuid().or(z.literal("")),
});

const MODE_WORD = { OFF: "import off", PREVIEW: "preview only", ON: "import on" } as const;

function refresh(reportId?: string) {
  revalidatePath("/admin/fastfield");
  if (reportId) revalidatePath(`/admin/fastfield/${reportId}`);
  revalidatePath("/dispatch");
  revalidatePath("/activities");
}

/** How a FastField form is imported: off / preview only / on, what it
 *  reports, whose sites it covers, and whose sites get a job made when a
 *  report matches nothing. */
export async function saveFastFieldForm(input: {
  formId: number;
  mode: string;
  jobType: string;
  customerId: string;
  createCustomerId: string;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const parsed = FormSettings.safeParse(input);
  if (!parsed.success) return fail("Those settings don't look right.");
  const d = parsed.data;
  if (d.customerId && d.createCustomerId && d.customerId !== d.createCustomerId) {
    return fail("This form only covers one client's sites, so it can only make jobs for that client.");
  }
  const form = await prisma.fastFieldForm.findUnique({
    where: { formId: d.formId },
    select: { formId: true, mode: true },
  });
  if (!form) return fail("That form no longer exists.");
  await prisma.fastFieldForm.update({
    where: { formId: d.formId },
    data: {
      mode: d.mode,
      jobType: d.jobType as JobType,
      customerId: d.customerId || null,
      createCustomerId: d.createCustomerId || null,
    },
  });
  if (form.mode !== d.mode) {
    await logActivity({
      entity: "FastFieldForm",
      entityId: String(d.formId),
      action: MODE_WORD[d.mode],
      userId: me.id,
    }).catch(() => {});
  }
  refresh();
  return okVoid();
}

/** Attach a report to a job, patrol visit or shift picked by hand. */
export async function linkFastFieldReport(
  reportId: string,
  kind: "job" | "visit" | "shift",
  activityId: string,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const note = `Linked by ${me.name || "the office"}.`;
  const res =
    kind === "job"
      ? await linkReportToJob(reportId, activityId, { note })
      : kind === "visit"
        ? await linkReportToVisit(reportId, activityId, { note })
        : await linkReportToShift(reportId, activityId, { note });
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
  const t = z.enum(REPORT_TYPES).safeParse(type);
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
  const left = Object.values(s.unmatched).reduce((n, x) => n + x, 0);
  return ok({ linked: s.linked, created: s.created, left });
}
