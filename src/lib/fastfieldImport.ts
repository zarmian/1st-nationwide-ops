/**
 * FastField import — attaches FastField reports to the activities they're
 * about. The robot (scripts/fastfield-forms.mjs) lists submissions, asks
 * planFastField() which ones are new, then sends each new one (answers,
 * photos already copied to our storage) to importFastField().
 *
 * Each report is matched to its site (form text, then GPS) and to the nearest
 * activity there within 3 hours — a callout job, a patrol visit or a lock /
 * unlock (lib/fastfield.ts). It is then attached the way an officer's own
 * report is: a FormSubmission with an approved review, and the activity marked
 * done with the officer's times, billed and paid. FastField reports were
 * already sent to the client from FastField, so they skip the review queue,
 * client emails and SMS acks.
 *
 * When nothing matches, a form set to "create callouts" (Shurgard) gets a
 * completed callout job; everything else waits on /admin/fastfield to be
 * linked by hand (linkReportToJob / linkReportToVisit / createJobForReport).
 */
import { Prisma, type JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime, formatTime } from "@/lib/dates";
import {
  applyBillingToVisit,
  applyPayToVisit,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
  payForOfficer,
  snapshotJobFinanceIfNeeded,
} from "@/lib/billing";
import {
  extractFacts,
  MATCH_WINDOW_MIN,
  pickActivity,
  pickOfficer,
  pickSite,
  type ActivityCandidate,
  type FastFieldAnswer,
  type FastFieldFacts,
  type FastFieldIncoming,
  type PersonRow,
  type SiteRow,
} from "@/lib/fastfield";

/** FastField's Shurgard activity log / call-out form. */
export const SHURGARD_FORM_ID = 549243;

/** An error's code or name only — never its message, which can quote the
 *  report's contents into the logs. */
const errCode = (e: unknown) =>
  (e as { code?: string })?.code ?? (e as Error)?.name ?? "error";

const ACTIVITY_NOUN: Record<string, string> = {
  ALARM_RESPONSE: "callout",
  PATROL: "patrol visit",
  LOCK: "lock-up",
  UNLOCK: "unlock",
  KEY_COLLECTION: "key collection",
  KEY_DROPOFF: "key drop-off",
  SURVEY: "survey",
  VPI: "VPI",
  ADHOC: "ad-hoc job",
};
const noun = (type: string) => ACTIVITY_NOUN[type] ?? "job";

/** Job statuses that a report completes. Later ones are left as they are. */
const UNFINISHED: string[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING"];
const VISIT_UNFINISHED: string[] = ["PENDING", "IN_PROGRESS", "LATE", "MISSED"];
/** Shift-type jobs are covered by their shift's own checks, not these forms. */
const NOT_MATCHABLE: JobType[] = ["STATIC_GUARDING_SHIFT", "DOG_HANDLER_SHIFT"];

type FormRow = {
  formId: number;
  name: string;
  customerId: string | null;
  enabled: boolean;
  createJobs: boolean;
  jobType: JobType;
};

const FORM_SELECT = {
  formId: true,
  name: true,
  customerId: true,
  enabled: true,
  createJobs: true,
  jobType: true,
} as const;

/** Whether a form's submissions are imported. A preview also includes forms
 *  that have a client set but aren't switched on yet, to show what would
 *  happen. */
function formIsOn(form: FormRow, preview: boolean): boolean {
  return form.enabled || (preview && form.customerId != null);
}

// ── Forms ─────────────────────────────────────────────────────────────────

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Defaults for a form seen for the first time: the Shurgard form reports
 *  Shurgard callouts (and creates them when nothing matches); another form is
 *  pointed at a client whose name it contains. Everything starts switched
 *  off — the office turns a form on at /admin/fastfield after a preview. */
async function firstSeenDefaults(formId: number, name: string) {
  if (formId === SHURGARD_FORM_ID || /shurgard/i.test(name)) {
    const shurgard = await prisma.customer.findFirst({
      where: { name: { contains: "Shurgard", mode: "insensitive" } },
      select: { id: true },
    });
    return {
      customerId: shurgard?.id ?? null,
      createJobs: true,
      jobType: "ALARM_RESPONSE" as JobType,
    };
  }
  const n = ` ${normName(name)} `;
  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  const hits = customers.filter((c) => {
    const cn = normName(c.name);
    return cn.length >= 4 && n.includes(` ${cn} `);
  });
  return { customerId: hits.length === 1 ? hits[0].id : null };
}

/** Record the forms the robot saw (new ones get defaults); returns them all. */
export async function ensureForms(
  forms: { formId: number; name: string }[],
): Promise<Map<number, FormRow>> {
  const names = new Map<number, string>();
  for (const f of forms) {
    names.set(f.formId, f.name.trim().slice(0, 200) || `Form ${f.formId}`);
  }
  const existing = await prisma.fastFieldForm.findMany({
    where: { formId: { in: Array.from(names.keys()) } },
    select: FORM_SELECT,
  });
  const byId = new Map<number, FormRow>(existing.map((f) => [f.formId, f]));
  const now = new Date();
  for (const [formId, name] of Array.from(names.entries())) {
    const known = byId.get(formId);
    if (!known) {
      const created = await prisma.fastFieldForm.upsert({
        where: { formId },
        create: { formId, name, lastSeenAt: now, ...(await firstSeenDefaults(formId, name)) },
        update: { name, lastSeenAt: now },
        select: FORM_SELECT,
      });
      byId.set(formId, created);
    } else if (known.name !== name) {
      byId.set(
        formId,
        await prisma.fastFieldForm.update({ where: { formId }, data: { name }, select: FORM_SELECT }),
      );
    }
  }
  if (existing.length) {
    await prisma.fastFieldForm.updateMany({
      where: { formId: { in: existing.map((f) => f.formId) } },
      data: { lastSeenAt: now },
    });
  }
  return byId;
}

// ── Plan: which submissions to fetch ──────────────────────────────────────

export type PlanInput = {
  forms: { formId: number; name: string }[];
  submissions: { submissionId: string; formId?: number | null; formName?: string | null }[];
};

export type PlanResult = {
  /** Submission ids the robot should open and send. */
  fetch: string[];
  counts: {
    listed: number;
    alreadyImported: number;
    formOff: number;
    unknownForm: number;
    toFetch: number;
  };
};

/**
 * Given the forms and the submission list the robot read, record the forms
 * and say which submissions are new and belong to a form that's switched on.
 * Writes only the form list (so /admin/fastfield can show it), even in a
 * preview.
 */
export async function planFastField(input: PlanInput, preview: boolean): Promise<PlanResult> {
  const forms = await ensureForms(input.forms);
  const byName = new Map<string, FormRow[]>();
  for (const f of Array.from(forms.values())) {
    const k = f.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), f]);
  }

  const ids = Array.from(new Set(input.submissions.map((s) => s.submissionId)));
  const imported = new Set(
    (
      await prisma.fastFieldReport.findMany({
        where: { submissionId: { in: ids } },
        select: { submissionId: true },
      })
    ).map((r) => r.submissionId),
  );

  const counts = { listed: ids.length, alreadyImported: 0, formOff: 0, unknownForm: 0, toFetch: 0 };
  const fetch: string[] = [];
  const seen = new Set<string>();
  for (const s of input.submissions) {
    if (seen.has(s.submissionId)) continue;
    seen.add(s.submissionId);
    if (imported.has(s.submissionId)) {
      counts.alreadyImported++;
      continue;
    }
    const byNameHits = s.formName ? byName.get(s.formName.trim().toLowerCase()) ?? [] : [];
    const form =
      (s.formId != null ? forms.get(s.formId) : undefined) ??
      (byNameHits.length === 1 ? byNameHits[0] : undefined);
    if (!form) {
      counts.unknownForm++;
      continue;
    }
    if (!formIsOn(form, preview)) {
      counts.formOff++;
      continue;
    }
    fetch.push(s.submissionId);
  }
  counts.toFetch = fetch.length;
  return { fetch, counts };
}

// ── Matching context (cached per run) ─────────────────────────────────────

export type Ctx = {
  sites: Map<string, SiteRow[]>;
  people: { active: PersonRow[]; inactive: PersonRow[] } | null;
  /** Preview only: activities already claimed by an earlier report in this
   *  run, and callouts it would have created. */
  claimed: Set<string>;
  virtual: { siteId: string; when: Date; type: string }[];
};

function newCtx(): Ctx {
  return { sites: new Map(), people: null, claimed: new Set(), virtual: [] };
}

async function sitesFor(ctx: Ctx, customerId: string | null): Promise<SiteRow[]> {
  const key = customerId ?? "*";
  const cached = ctx.sites.get(key);
  if (cached) return cached;
  const rows = await prisma.site.findMany({
    where: { active: true, ...(customerId ? { customerId } : {}) },
    select: {
      id: true,
      name: true,
      code: true,
      postcode: true,
      addressLine: true,
      city: true,
      lat: true,
      lng: true,
    },
  });
  const sites = rows.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    postcode: s.postcode,
    address: [s.addressLine, s.city].filter(Boolean).join(" "),
    lat: s.lat,
    lng: s.lng,
  }));
  ctx.sites.set(key, sites);
  return sites;
}

async function officerFor(ctx: Ctx, facts: FastFieldFacts): Promise<string | null> {
  if (!ctx.people) {
    const staff = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "DISPATCHER", "OFFICER"] } },
      select: { id: true, name: true, siaNumber: true, active: true },
    });
    ctx.people = {
      active: staff.filter((u) => u.active),
      inactive: staff.filter((u) => !u.active),
    };
  }
  return pickOfficer(facts, ctx.people.active) ?? pickOfficer(facts, ctx.people.inactive);
}

/** Jobs and patrol visits at a site within the matching window. */
async function candidatesNear(siteId: string, when: Date): Promise<ActivityCandidate[]> {
  const from = new Date(when.getTime() - MATCH_WINDOW_MIN * 60000);
  const to = new Date(when.getTime() + MATCH_WINDOW_MIN * 60000);
  const range = { gte: from, lte: to };
  const [jobs, visits] = await Promise.all([
    prisma.job.findMany({
      where: {
        siteId,
        status: { not: "CANCELLED" },
        handledByPartnerId: null,
        patrolVisitId: null, // the visit itself is the candidate
        type: { notIn: NOT_MATCHABLE },
        OR: [
          { scheduledFor: range },
          { startedAt: range },
          { completedAt: range },
          { scheduledFor: null, startedAt: null, completedAt: null, createdAt: range },
        ],
      },
      select: {
        id: true,
        type: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        _count: { select: { fastfieldReports: true } },
      },
      take: 50,
    }),
    prisma.patrolVisit.findMany({
      where: {
        siteId,
        status: { not: "CANCELLED" },
        handledByPartnerId: null,
        OR: [{ scheduledAt: range }, { arrivedAt: range }],
      },
      select: {
        id: true,
        scheduledAt: true,
        arrivedAt: true,
        departedAt: true,
        _count: { select: { fastfieldReports: true } },
      },
      take: 50,
    }),
  ]);
  const present = (ds: (Date | null)[]) => ds.filter((d): d is Date => d != null);
  return [
    ...jobs.map((j) => {
      const times = present([j.scheduledFor, j.startedAt, j.completedAt]);
      return {
        kind: "job" as const,
        id: j.id,
        type: j.type,
        times: times.length ? times : [j.createdAt],
        taken: j._count.fastfieldReports > 0,
      };
    }),
    ...visits.map((v) => ({
      kind: "visit" as const,
      id: v.id,
      type: "PATROL",
      times: present([v.scheduledAt, v.arrivedAt, v.departedAt]),
      taken: v._count.fastfieldReports > 0,
    })),
  ];
}

// ── Deciding what to do with a report ─────────────────────────────────────

export type UnmatchedReason = "site" | "none" | "taken" | "ambiguous";

type Decision =
  | { action: "link"; site: SiteRow; target: ActivityCandidate; note: string }
  | { action: "create"; site: SiteRow; note: string }
  | { action: "unmatched"; site: SiteRow | null; reason: UnmatchedReason; note: string };

function siteHow(how: "name" | "name+gps" | "gps", distanceM: number | null): string {
  if (how === "gps") return ` Site found by GPS (${Math.round(distanceM ?? 0)} m away).`;
  if (how === "name+gps") return " Site found by name and GPS.";
  return "";
}

async function decide(
  ctx: Ctx,
  facts: FastFieldFacts,
  form: FormRow,
  preview: boolean,
): Promise<Decision> {
  const sites = await sitesFor(ctx, form.customerId);
  const sp = pickSite(facts.siteText, facts.lat, facts.lng, sites);
  if (!sp.site) return { action: "unmatched", site: null, reason: "site", note: sp.reason };
  const site = sp.site;
  const how = siteHow(sp.how, sp.distanceM);

  let candidates = await candidatesNear(site.id, facts.when);
  if (preview) {
    candidates = candidates.map((c) => (ctx.claimed.has(c.id) ? { ...c, taken: true } : c));
    for (const v of ctx.virtual) {
      if (v.siteId === site.id) {
        candidates.push({ kind: "job", id: `virtual-${candidates.length}`, type: v.type, times: [v.when], taken: true });
      }
    }
  }

  const ap = pickActivity(facts.when, form.jobType, candidates);
  if (ap.pick) {
    const at = ap.pick.times.reduce((best, t) =>
      Math.abs(t.getTime() - facts.when.getTime()) < Math.abs(best.getTime() - facts.when.getTime()) ? t : best,
    );
    return {
      action: "link",
      site,
      target: ap.pick,
      note: `Matched to the ${noun(ap.pick.type)} at ${formatTime(at)} (${ap.minutesApart} min apart).${how}`,
    };
  }
  if (ap.reason === "none" && form.createJobs) {
    return {
      action: "create",
      site,
      note: `No activity at ${site.name} within 3 hours, so the ${noun(form.jobType)} was created.${how}`,
    };
  }
  const when = formatDateTime(facts.when);
  const note =
    ap.reason === "none"
      ? `No activity at ${site.name} within 3 hours of ${when}.`
      : ap.reason === "taken"
        ? `The activity at ${site.name} near ${when} already has a FastField report.`
        : `More than one activity at ${site.name} is about as close to ${when} — pick the right one.`;
  return { action: "unmatched", site, reason: ap.reason, note: note + how };
}

// ── Import ────────────────────────────────────────────────────────────────

export type ImportSummary = {
  received: number;
  alreadyImported: number;
  formOff: number;
  linked: number;
  /** Linked, by the type of activity (ALARM_RESPONSE, PATROL, LOCK, …). */
  linkedByType: Record<string, number>;
  created: number;
  unmatched: Record<UnmatchedReason, number>;
  failed: number;
};

function emptySummary(received: number): ImportSummary {
  return {
    received,
    alreadyImported: 0,
    formOff: 0,
    linked: 0,
    linkedByType: {},
    created: 0,
    unmatched: { site: 0, none: 0, taken: 0, ambiguous: 0 },
    failed: 0,
  };
}

function tally(summary: ImportSummary, d: Decision) {
  if (d.action === "link") {
    summary.linked++;
    summary.linkedByType[d.target.type] = (summary.linkedByType[d.target.type] ?? 0) + 1;
  } else if (d.action === "create") {
    summary.created++;
  } else {
    summary.unmatched[d.reason]++;
  }
}

function incomingTimes(r: FastFieldIncoming) {
  const d = (s: string | null | undefined) => {
    if (!s) return null;
    const t = new Date(s);
    return Number.isFinite(t.getTime()) ? t : null;
  };
  return {
    submittedAt: d(r.submittedAt) ?? new Date(),
    startedAt: d(r.startedAt),
    finishedAt: d(r.finishedAt),
  };
}

/**
 * Import reports the robot sends. Re-sending one already imported does
 * nothing, so a run can be repeated safely. With preview, nothing is written
 * and the summary says what would happen.
 */
export async function importFastField(
  reports: FastFieldIncoming[],
  preview: boolean,
): Promise<ImportSummary> {
  const summary = emptySummary(reports.length);
  if (reports.length === 0) return summary;

  const forms = await ensureForms(
    reports.map((r) => ({ formId: r.formId, name: r.formName })),
  );
  const imported = new Set(
    (
      await prisma.fastFieldReport.findMany({
        where: { submissionId: { in: reports.map((r) => r.submissionId) } },
        select: { submissionId: true },
      })
    ).map((r) => r.submissionId),
  );

  // Oldest first, so an earlier report claims an activity before a later one.
  const work = reports
    .map((r) => {
      const t = incomingTimes(r);
      return { r, t, facts: extractFacts({ ...t, answers: r.answers }) };
    })
    .sort((a, b) => a.facts.when.getTime() - b.facts.when.getTime());

  const ctx = newCtx();
  const done = new Set<string>();
  for (const { r, t, facts } of work) {
    if (imported.has(r.submissionId) || done.has(r.submissionId)) {
      summary.alreadyImported++;
      continue;
    }
    done.add(r.submissionId);
    const form = forms.get(r.formId)!;
    if (!formIsOn(form, preview)) {
      summary.formOff++;
      continue;
    }

    try {
      const decision = await decide(ctx, facts, form, preview);
      if (preview) {
        tally(summary, decision);
        if (decision.action === "link") ctx.claimed.add(decision.target.id);
        if (decision.action === "create") {
          ctx.virtual.push({ siteId: decision.site.id, when: facts.when, type: form.jobType });
        }
        continue;
      }

      let row: { id: string };
      try {
        row = await prisma.fastFieldReport.create({
          data: {
            submissionId: r.submissionId,
            formId: r.formId,
            submittedAt: t.submittedAt,
            startedAt: t.startedAt,
            finishedAt: t.finishedAt,
            submittedBy: r.submittedBy ?? null,
            officerText: facts.officerText,
            siteText: facts.siteText,
            lat: facts.lat,
            lng: facts.lng,
            answers: r.answers as unknown as Prisma.InputJsonValue,
            photoUrls: r.photoUrls ?? [],
            signatureUrl: r.signatureUrl ?? null,
            status: "UNMATCHED",
            note: decision.note,
            siteId: decision.site?.id ?? null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          summary.alreadyImported++; // imported by an overlapping run
          continue;
        }
        throw e;
      }

      await applyAndTally(ctx, row.id, decision, form, summary);
    } catch (e) {
      console.error("FastField import failed for one report:", errCode(e));
      summary.failed++;
    }
  }
  return summary;
}

/** Carry out a decision on a stored report. If attaching fails (the activity
 *  changed meanwhile), the report stays unmatched with the reason. */
async function applyAndTally(
  ctx: Ctx,
  reportId: string,
  decision: Decision,
  form: FormRow,
  summary: ImportSummary,
) {
  const applied = await applyDecision(ctx, reportId, decision, form);
  if (applied.ok) {
    tally(summary, decision);
    return;
  }
  summary.failed++;
  await prisma.fastFieldReport.update({
    where: { id: reportId },
    data: { note: `Couldn't attach automatically: ${applied.error}` },
  });
}

async function applyDecision(
  ctx: Ctx,
  reportId: string,
  d: Decision,
  form: FormRow,
): Promise<ActionResult> {
  if (d.action === "link") {
    return d.target.kind === "job"
      ? linkReportToJob(reportId, d.target.id, { note: d.note, ctx })
      : linkReportToVisit(reportId, d.target.id, { note: d.note, ctx });
  }
  if (d.action === "create") {
    return createJobForReport(reportId, { siteId: d.site.id, type: form.jobType, note: d.note, ctx });
  }
  return { ok: true };
}

/**
 * Try the unmatched reports again — an activity may have been added since,
 * or a site fixed. Recent ones only, unless specific ids are given.
 */
export async function retryUnmatched(
  opts: { ids?: string[]; sinceDays?: number; limit?: number } = {},
): Promise<ImportSummary> {
  const since = new Date(Date.now() - (opts.sinceDays ?? 7) * 86_400_000);
  const rows = await prisma.fastFieldReport.findMany({
    where: {
      status: "UNMATCHED",
      ...(opts.ids ? { id: { in: opts.ids } } : { submittedAt: { gte: since } }),
      form: { enabled: true },
    },
    orderBy: { submittedAt: "asc" },
    take: opts.limit ?? 100,
    select: {
      id: true,
      siteId: true,
      note: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      answers: true,
      form: { select: FORM_SELECT },
    },
  });
  const summary = emptySummary(rows.length);
  const ctx = newCtx();
  for (const row of rows) {
    try {
      const facts = extractFacts({
        submittedAt: row.submittedAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        answers: row.answers as unknown as FastFieldAnswer[],
      });
      const decision = await decide(ctx, facts, row.form, false);
      if (decision.action === "unmatched") {
        const siteId = decision.site?.id ?? null;
        if (siteId !== row.siteId || decision.note !== row.note) {
          await prisma.fastFieldReport.update({
            where: { id: row.id },
            data: { siteId, note: decision.note },
          });
        }
        tally(summary, decision);
        continue;
      }
      await applyAndTally(ctx, row.id, decision, row.form, summary);
    } catch (e) {
      console.error("FastField retry failed for one report:", errCode(e));
      summary.failed++;
    }
  }
  return summary;
}

// ── Attaching (automatic and by hand) ─────────────────────────────────────

export type ActionResult = { ok: true } | { ok: false; error: string };

const REPORT_SELECT = {
  id: true,
  submissionId: true,
  status: true,
  formSubmissionId: true,
  submittedAt: true,
  startedAt: true,
  finishedAt: true,
  officerText: true,
  answers: true,
  photoUrls: true,
  signatureUrl: true,
  form: { select: { formId: true, name: true, jobType: true } },
} as const;

type StoredReport = Prisma.FastFieldReportGetPayload<{ select: typeof REPORT_SELECT }>;

async function loadOpenReport(reportId: string): Promise<StoredReport | { error: string }> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: REPORT_SELECT,
  });
  if (!report) return { error: "FastField report not found." };
  if (report.formSubmissionId || report.status === "LINKED" || report.status === "CREATED") {
    return { error: "This FastField report is already attached to an activity." };
  }
  return report;
}

function factsOf(report: StoredReport): FastFieldFacts {
  return extractFacts({
    submittedAt: report.submittedAt,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    answers: report.answers as unknown as FastFieldAnswer[],
  });
}

/** What the attached FormSubmission holds. The answers themselves stay on the
 *  FastFieldReport (the review page reads them from there). */
function submissionPayload(report: StoredReport): Prisma.InputJsonValue {
  return {
    source: "fastfield",
    fastfield: {
      submissionId: report.submissionId,
      formId: report.form.formId,
      formName: report.form.name,
    },
    photoUrls: report.photoUrls,
    ...(report.signatureUrl ? { signatureUrl: report.signatureUrl } : {}),
  };
}

const SUBMISSION_FORM: Record<string, string> = {
  ALARM_RESPONSE: "ALARM_RESPONSE",
  PATROL: "PATROL",
  LOCK: "LOCK",
  UNLOCK: "UNLOCK",
  KEY_COLLECTION: "KEY_COLLECTION",
  KEY_DROPOFF: "KEY_DROPOFF",
  VPI: "VPI",
};

function visitTimes(facts: FastFieldFacts, report: StoredReport) {
  const arrived = facts.arrivedAt ?? facts.openedAt;
  const departed = facts.departedAt ?? facts.closedAt;
  return { arrived, departed, done: departed ?? report.submittedAt };
}

async function createSubmission(
  tx: Prisma.TransactionClient,
  report: StoredReport,
  facts: FastFieldFacts,
  target: { form: string; siteId: string | null; jobId?: string; patrolVisitId?: string },
  officerId: string | null,
): Promise<string> {
  const { arrived, departed } = visitTimes(facts, report);
  const sub = await tx.formSubmission.create({
    data: {
      form: target.form as any,
      siteId: target.siteId,
      jobId: target.jobId ?? null,
      patrolVisitId: target.patrolVisitId ?? null,
      submittedByUserId: officerId,
      officerNameRaw: (facts.officerName ?? facts.officerText ?? "FastField").slice(0, 120),
      arrivedAt: arrived,
      departedAt: departed,
      payload: submissionPayload(report),
      submittedAt: report.submittedAt,
    },
    select: { id: true },
  });
  await tx.reportReview.create({
    data: {
      submissionId: sub.id,
      status: "APPROVED",
      reviewedAt: new Date(),
      reviewerNotes: "Imported from FastField.",
    },
  });
  return sub.id;
}

/** Attach a report to a job and mark the job done with the officer's times. */
export async function linkReportToJob(
  reportId: string,
  jobId: string,
  opts: { note?: string; ctx?: Ctx } = {},
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error };
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      type: true,
      status: true,
      siteId: true,
      startedAt: true,
      completedAt: true,
      lat: true,
      assignedToUserId: true,
      handledByPartnerId: true,
      responderType: true,
    },
  });
  if (!job) return { ok: false, error: "Activity not found." };
  if (job.status === "CANCELLED") return { ok: false, error: "That activity was cancelled." };

  const facts = factsOf(report);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  const { arrived, done } = visitTimes(facts, report);

  await prisma.$transaction(async (tx) => {
    const submissionId = await createSubmission(
      tx,
      report,
      facts,
      { form: SUBMISSION_FORM[job.type] ?? "ADHOC", siteId: job.siteId, jobId: job.id },
      officerId,
    );
    const fillOfficer =
      !job.assignedToUserId && !job.handledByPartnerId && officerId != null;
    await tx.job.update({
      where: { id: job.id },
      data: {
        ...(UNFINISHED.includes(job.status) ? { status: "APPROVED" as const } : {}),
        ...(!job.startedAt && arrived ? { startedAt: arrived } : {}),
        ...(!job.completedAt ? { completedAt: done } : {}),
        ...(job.lat == null && facts.lat != null
          ? { lat: facts.lat, lng: facts.lng, locatedAt: arrived ?? report.submittedAt }
          : {}),
        ...(fillOfficer
          ? {
              assignedToUserId: officerId,
              responderType: job.responderType ?? ("INTERNAL_OFFICER" as const),
            }
          : {}),
      },
    });
    await tx.fastFieldReport.update({
      where: { id: report.id },
      data: {
        status: "LINKED",
        jobId: job.id,
        siteId: job.siteId,
        formSubmissionId: submissionId,
        ...(opts.note ? { note: opts.note } : {}),
      },
    });
  });

  await snapshotJobFinanceIfNeeded(job.id).catch((e) =>
    console.error("snapshotJobFinanceIfNeeded failed", e),
  );
  return { ok: true };
}

/** Attach a report to a patrol visit and complete the visit (billed + paid
 *  like an officer's own report). */
export async function linkReportToVisit(
  reportId: string,
  visitId: string,
  opts: { note?: string; ctx?: Ctx } = {},
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error };
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      siteId: true,
      status: true,
      officerId: true,
      scheduledAt: true,
      scheduleDate: true,
      arrivedAt: true,
      departedAt: true,
      lat: true,
      photoUrls: true,
      billedAmount: true,
      paidAmount: true,
      handledByPartnerId: true,
    },
  });
  if (!visit) return { ok: false, error: "Patrol visit not found." };
  if (visit.status === "CANCELLED") return { ok: false, error: "That visit was cancelled." };

  const facts = factsOf(report);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  const { arrived, done } = visitTimes(facts, report);
  const arrivedAt = visit.arrivedAt ?? arrived ?? done;
  const departedAt = visit.departedAt ?? done;
  const attendingOfficer = visit.handledByPartnerId ? null : visit.officerId ?? officerId;

  await prisma.$transaction(async (tx) => {
    const submissionId = await createSubmission(
      tx,
      report,
      facts,
      { form: "PATROL", siteId: visit.siteId, patrolVisitId: visit.id },
      officerId,
    );
    await tx.patrolVisit.update({
      where: { id: visit.id },
      data: {
        ...(VISIT_UNFINISHED.includes(visit.status) ? { status: "COMPLETED" as const } : {}),
        arrivedAt,
        departedAt,
        ...(visit.lat == null && facts.lat != null
          ? { lat: facts.lat, lng: facts.lng, locatedAt: arrivedAt }
          : {}),
        ...(visit.photoUrls.length === 0 && report.photoUrls.length
          ? { photoUrls: report.photoUrls }
          : {}),
        ...(!visit.officerId && !visit.handledByPartnerId && officerId
          ? { officerId }
          : {}),
      },
    });
    await tx.fastFieldReport.update({
      where: { id: report.id },
      data: {
        status: "LINKED",
        patrolVisitId: visit.id,
        siteId: visit.siteId,
        formSubmissionId: submissionId,
        ...(opts.note ? { note: opts.note } : {}),
      },
    });
  });

  // Billing + pay snapshot, only where the visit has none yet. Accounting
  // date = the scheduled night, as for an officer's own report.
  try {
    const service = jobTypeToRateService("PATROL");
    const at = visit.scheduleDate ?? visit.scheduledAt;
    const duration = durationMinutes(arrivedAt, departedAt);
    if (service && visit.billedAmount == null) {
      const bill = await billForSite(visit.siteId, service, duration);
      if (bill.ok) await applyBillingToVisit(visit.id, bill, at);
    }
    if (service && visit.paidAmount == null && attendingOfficer) {
      const pay = await payForOfficer(attendingOfficer, service, duration);
      if (pay.ok) await applyPayToVisit(visit.id, pay, at);
    }
  } catch (e) {
    console.error("FastField visit finance failed:", errCode(e));
  }
  return { ok: true };
}

/** Create the completed job a report describes (a callout nobody logged)
 *  and attach the report to it. */
export async function createJobForReport(
  reportId: string,
  opts: { siteId: string; type?: JobType; note?: string; ctx?: Ctx },
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error };
  const site = await prisma.site.findUnique({
    where: { id: opts.siteId },
    select: { id: true, name: true, customerId: true, partnerId: true, active: true },
  });
  if (!site) return { ok: false, error: "Site not found." };
  if (!site.active) return { ok: false, error: "That site is inactive." };

  const type = opts.type ?? report.form.jobType;
  const facts = factsOf(report);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  const { arrived, done } = visitTimes(facts, report);

  const jobId = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        type,
        source: type === "ALARM_RESPONSE" ? "ALARM" : "CUSTOMER_REQUEST",
        status: "APPROVED",
        priority: "MEDIUM",
        siteId: site.id,
        customerId: site.customerId,
        partnerId: site.partnerId,
        responderType: "INTERNAL_OFFICER",
        assignedToUserId: officerId,
        startedAt: arrived,
        completedAt: done,
        ...(facts.lat != null
          ? { lat: facts.lat, lng: facts.lng, locatedAt: arrived ?? report.submittedAt }
          : {}),
        notes: `Recorded from the FastField report “${report.form.name}”.`,
      },
      select: { id: true },
    });
    const submissionId = await createSubmission(
      tx,
      report,
      facts,
      { form: SUBMISSION_FORM[type] ?? "ADHOC", siteId: site.id, jobId: job.id },
      officerId,
    );
    await tx.fastFieldReport.update({
      where: { id: report.id },
      data: {
        status: "CREATED",
        jobCreated: true,
        jobId: job.id,
        siteId: site.id,
        formSubmissionId: submissionId,
        note: opts.note ?? `The ${noun(type)} at ${site.name} was created from this report.`,
      },
    });
    return job.id;
  });

  await snapshotJobFinanceIfNeeded(jobId).catch((e) =>
    console.error("snapshotJobFinanceIfNeeded failed", e),
  );
  return { ok: true };
}

/** Set a report aside (a test, a duplicate) or bring it back. */
export async function setReportIgnored(
  reportId: string,
  ignored: boolean,
  note?: string,
): Promise<ActionResult> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: { status: true },
  });
  if (!report) return { ok: false, error: "FastField report not found." };
  if (report.status === "LINKED" || report.status === "CREATED") {
    return { ok: false, error: "This report is already attached to an activity." };
  }
  await prisma.fastFieldReport.update({
    where: { id: reportId },
    data: { status: ignored ? "IGNORED" : "UNMATCHED", ...(note ? { note } : {}) },
  });
  return { ok: true };
}

/** Activities near a report's time at a site, for linking by hand. */
export async function activitiesNearReport(
  reportId: string,
  siteId: string,
): Promise<
  {
    kind: "job" | "visit";
    id: string;
    type: string;
    at: Date;
    minutesApart: number;
    taken: boolean;
  }[]
> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: REPORT_SELECT,
  });
  if (!report) return [];
  const facts = factsOf(report);
  const candidates = await candidatesNear(siteId, facts.when);
  return candidates
    .map((c) => {
      const at = c.times.reduce((best, t) =>
        Math.abs(t.getTime() - facts.when.getTime()) < Math.abs(best.getTime() - facts.when.getTime()) ? t : best,
      );
      return {
        kind: c.kind,
        id: c.id,
        type: c.type,
        at,
        minutesApart: Math.round(Math.abs(at.getTime() - facts.when.getTime()) / 60000),
        taken: c.taken,
      };
    })
    .sort((a, b) => a.minutesApart - b.minutesApart);
}
