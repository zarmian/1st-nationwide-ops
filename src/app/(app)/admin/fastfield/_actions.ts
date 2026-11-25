"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { fail, ok, okVoid, type ActionResult } from "@/lib/actionResult";
import { logActivity } from "@/lib/audit";
import { retryMessage } from "@/lib/fastfieldAdminList";
import {
  createJobForReport,
  linkReportToJob,
  linkReportToShift,
  linkReportToVisit,
  retryUnmatched,
  setReportIgnored,
  skipPlace,
  stopSkipping,
  unlinkReportFromActivity,
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

/**
 * After a change: the FastField pages, and every page a report shows on —
 * the lists, and the job, visit, shift and review pages it can be attached to
 * (by route, as which ones changed isn't always known here). They're all
 * rendered fresh on each request today, so this mostly makes Next send the
 * calling page back re-rendered with the action's result and drop its cached
 * pages; it also keeps them right if one is ever cached.
 */
function refresh(reportId?: string) {
  revalidatePath("/admin/fastfield");
  if (reportId) revalidatePath(`/admin/fastfield/${reportId}`);
  revalidatePath("/dispatch");
  revalidatePath("/activities");
  revalidatePath("/dispatch/[id]", "page");
  revalidatePath("/patrols/visits/[id]", "page");
  revalidatePath("/shifts/[id]", "page");
  revalidatePath("/admin/reports/[id]", "page");
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

const Id = z.string().uuid();
const LinkInput = z.object({ reportId: Id, kind: z.enum(["job", "visit", "shift"]), activityId: Id });

/** The page an activity opens on. */
function activityPath(kind: "job" | "visit" | "shift", id: string): string {
  return kind === "job" ? `/dispatch/${id}` : kind === "visit" ? `/patrols/visits/${id}` : `/shifts/${id}`;
}

/** Attach a report to a job, patrol visit or shift picked by hand. Any
 *  report can go on any of them: the robot leaves a hand link where it was
 *  put. The link function writes the activity's history. */
export async function linkFastFieldReport(
  reportId: string,
  kind: "job" | "visit" | "shift",
  activityId: string,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const parsed = LinkInput.safeParse({ reportId, kind, activityId });
  if (!parsed.success) return fail("That link doesn't look right. Reload the page and try again.");
  const d = parsed.data;
  const opts = { note: `Linked by ${me.name || "the office"}.`, byHand: true, byUserId: me.id };
  const res =
    d.kind === "job"
      ? await linkReportToJob(d.reportId, d.activityId, opts)
      : d.kind === "visit"
        ? await linkReportToVisit(d.reportId, d.activityId, opts)
        : await linkReportToShift(d.reportId, d.activityId, opts);
  if (!res.ok) return fail(res.error);
  revalidatePath(activityPath(d.kind, d.activityId));
  refresh(d.reportId);
  return okVoid();
}

/** Create the job a report describes, at a site picked by hand. */
export async function createFastFieldJob(
  reportId: string,
  siteId: string,
  type: string,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!Id.safeParse(reportId).success) return fail("That report doesn't look right.");
  if (!Id.safeParse(siteId).success) return fail("Pick the site first.");
  const t = z.enum(REPORT_TYPES).safeParse(type);
  if (!t.success) return fail("Pick the kind of job to create.");
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { name: true } });
  if (!site) return fail("Pick the site first.");
  const res = await createJobForReport(reportId, {
    siteId,
    type: t.data as JobType,
    note: `Job at ${site.name} created by ${me.name || "the office"}.`,
    byUserId: me.id,
  });
  if (!res.ok) return fail(res.error);
  refresh(reportId);
  return okVoid();
}

/** Set a report aside (a test, a duplicate) or bring it back. Logged on the
 *  report's history. */
export async function ignoreFastFieldReport(
  reportId: string,
  ignored: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!Id.safeParse(reportId).success || typeof ignored !== "boolean") {
    return fail("That report doesn't look right.");
  }
  const by = me.name || "the office";
  const res = await setReportIgnored(
    reportId,
    ignored,
    // Brought back, the "Set aside by …" note would no longer be true.
    ignored ? `Set aside by ${by}.` : `Brought back by ${by}.`,
  );
  if (!res.ok) return fail(res.error);
  await logActivity({
    entity: "FastFieldReport",
    entityId: reportId,
    action: ignored ? "fastfield_set_aside" : "fastfield_brought_back",
    userId: me.id,
  }).catch(() => {});
  refresh(reportId);
  return okVoid();
}

/** Take a report off what it's attached to — a shift, job or patrol visit,
 *  or the job made from it. It goes back to Needs linking, and the robot
 *  never links it again. What the link changed on a job or visit is undone
 *  where that's safe; `check` lists what the person should look at. */
export async function unlinkFastFieldReport(
  reportId: string,
): Promise<ActionResult<{ check: string[] }>> {
  const me = await requireAdmin();
  if (!Id.safeParse(reportId).success) return fail("That report doesn't look right.");
  const before = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: { status: true, shiftId: true, jobId: true, patrolVisitId: true },
  });
  const res = await unlinkReportFromActivity(reportId, me.name || "the office", { byUserId: me.id });
  if (!res.ok) return fail(res.error);
  if (before?.status === "LINKED" && before.shiftId) {
    // Shift links come off through unlinkReportFromShift, which leaves the
    // shift's history to us.
    await logActivity({
      entity: "Shift",
      entityId: before.shiftId,
      action: "fastfield_unlinked",
      userId: me.id,
      diff: { fastfieldReportId: reportId },
    }).catch(() => {});
    revalidatePath(`/shifts/${before.shiftId}`);
  }
  if (before?.jobId) revalidatePath(`/dispatch/${before.jobId}`);
  if (before?.patrolVisitId) revalidatePath(`/patrols/visits/${before.patrolVisitId}`);
  refresh(reportId);
  return ok({ check: res.check ?? [] });
}

/** Skip a place: set aside its waiting reports, and new ones typed the same
 *  way as they arrive (unless they match an activity). skipPlace writes the
 *  history line (`fastfield_skip_place`, with who). */
export async function skipFastFieldPlace(
  key: string,
): Promise<ActionResult<{ label: string; setAside: number }>> {
  const me = await requireAdmin();
  const parsed = z.string().min(1).max(300).regex(/^[a-z0-9]+$/).safeParse(key);
  if (!parsed.success) return fail("That place doesn't look right.");
  const res = await skipPlace(parsed.data, me.name || "the office", { byUserId: me.id });
  if (!res.ok) return fail(res.error);
  refresh();
  return ok({ label: res.label, setAside: res.setAside });
}

/** Stop skipping a place: its set-aside reports wait again (stopSkipping
 *  says per report what happens next, and writes `fastfield_stop_skipping`). */
export async function stopSkippingFastFieldPlace(
  skipId: string,
): Promise<ActionResult<{ label: string; broughtBack: number; waitForYou: number }>> {
  const me = await requireAdmin();
  if (!z.string().uuid().safeParse(skipId).success) return fail("That place doesn't look right.");
  const res = await stopSkipping(skipId, me.name || "the office", { byUserId: me.id });
  if (!res.ok) return fail(res.error);
  refresh();
  return ok({ label: res.label, broughtBack: res.broughtBack, waitForYou: res.waitForYou });
}

/** How long one press of "Try matching again" matches for. The page's
 *  function may run 60 seconds; this leaves room for the rest of the request. */
const RETRY_BUDGET_MS = 35_000;

/**
 * Re-run matching on the waiting reports from the last 60 days — the ones
 * most likely to match first, then the rest, as many as fit in 35 seconds.
 * Pressing again carries on with those not reached. When the robot is already
 * matching (it holds the run lock), nothing is done and the button says so.
 *
 * Deliberately no refresh() here: revalidating would make Next re-render this
 * heavy page inside the same request, after up to 35 seconds of matching. The
 * button asks for the page again itself (router.refresh(), which also clears
 * the browser's cached pages), as a separate request with its own time limit.
 */
export async function retryFastFieldMatching(): Promise<
  ActionResult<{
    attached: number;
    checked: number;
    notReached: number;
    busy: boolean;
    tone: "info" | "success";
    message: string;
  }>
> {
  await requireAdmin();
  const s = await retryUnmatched({ sinceDays: 60, all: true, budgetMs: RETRY_BUDGET_MS });
  const counts = {
    attached: s.linked + s.created,
    checked: s.checked,
    notReached: s.notReached,
    busy: !!s.busy,
  };
  return ok({ ...counts, ...retryMessage(counts) });
}
