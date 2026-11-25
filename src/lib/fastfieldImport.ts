/**
 * FastField import — attaches FastField reports to the activities they're
 * about. The robot (scripts/fastfield-forms.mjs) lists submissions, asks
 * planFastField() which ones are new, then sends each new one (answers,
 * photos already copied to our storage) to importFastField().
 *
 * Forms are shared between clients (the Site Patrol and Alarm Response forms
 * are used for Shurgard and others), so the site in the report decides the
 * client: a postcode typed in the site name, else the name, else GPS
 * (lib/fastfield.ts). The report then goes to:
 *   - the static / dog-handler shift it fits inside, for patrol forms — a
 *     shift takes any number of reports, one per patrol round, and a report
 *     never goes on a shift it starts before or finishes after;
 *   - otherwise the nearest job or patrol visit there within 3 hours.
 * It is attached the way an officer's own report is: a FormSubmission with an
 * approved review, and (for a job or visit) the activity marked done with the
 * officer's times, billed and paid. FastField reports were already sent to
 * the client from FastField, so they skip the review queue, client emails and
 * SMS acks.
 *
 * When nothing matches, the job is created only at the client the form names
 * for that (Shurgard); everything else waits on /admin/fastfield to be linked
 * by hand (linkReportToJob / linkReportToVisit / linkReportToShift /
 * createJobForReport).
 */
import { Prisma, type FastFieldFormMode, type FastFieldUnlinkBy, type JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FASTFIELD_RULES_VERSION } from "@/lib/fastfieldRulesVersion";
import { formatDateTime, formatTime } from "@/lib/dates";
import { haversineMeters } from "@/lib/geo";
import { fillJobFinance, fillVisitFinance, type FinanceFilled } from "@/lib/billing";
import { logActivity } from "@/lib/audit";
import { sentToClient } from "@/lib/fastfieldSentToClient";
import {
  planCreatedJobUndo,
  planJobLink,
  planUnlinkUndo,
  planVisitLink,
  readLinkPrev,
  visitKind,
  type LinkPrev,
  type ReportFill,
} from "@/lib/fastfieldAttach";
import {
  apartText,
  extractFacts,
  MANUAL_LINK_WINDOW_MIN,
  MATCH_WINDOW_MIN,
  WIDE_MATCH_WINDOW_MIN,
  groupByPlace,
  pickActivity,
  pickActivityWide,
  pickOfficer,
  pickShift,
  pickSite,
  pickSiteByActivity,
  SHIFT_GRACE_MIN,
  outsideShiftText,
  reportSpan,
  shiftLinkAction,
  shiftApartMin,
  shiftFit,
  shiftHoursText,
  shiftsOn,
  spanText,
  siteKey,
  type ActivityCandidate,
  type CustomerRow,
  type FastFieldAnswer,
  type FastFieldFacts,
  type FastFieldIncoming,
  type PersonRow,
  type ReportSpan,
  type ShiftCandidate,
  type SiteHow,
  type SiteRow,
} from "@/lib/fastfield";

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
  SHIFT: "static shift",
};
const noun = (type: string) => ACTIVITY_NOUN[type] ?? "job";

/** Job statuses that a report completes. Later ones are left as they are. */
const UNFINISHED: string[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING"];
const VISIT_UNFINISHED: string[] = ["PENDING", "IN_PROGRESS", "LATE", "MISSED"];
/** Shift-type jobs stand for their shift, which is matched directly. */
const NOT_MATCHABLE: JobType[] = ["STATIC_GUARDING_SHIFT", "DOG_HANDLER_SHIFT"];

type FormRow = {
  formId: number;
  name: string;
  customerId: string | null;
  mode: FastFieldFormMode;
  jobType: JobType;
  createCustomerId: string | null;
};

const FORM_SELECT = {
  formId: true,
  name: true,
  customerId: true,
  mode: true,
  jobType: true,
  createCustomerId: true,
} as const;

/** Whether a form's submissions are read: a preview takes the forms set to
 *  Preview only as well as those switched on. */
function formIsOn(form: FormRow, preview: boolean): boolean {
  return preview ? form.mode !== "OFF" : form.mode === "ON";
}

// ── Forms ─────────────────────────────────────────────────────────────────

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function shurgardId(): Promise<string | null> {
  const c = await prisma.customer.findFirst({
    where: { name: { contains: "Shurgard", mode: "insensitive" } },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  return c?.id ?? null;
}

/** Starting settings for a form seen for the first time, from its name: a
 *  Shurgard-titled form reports Shurgard callouts and creates them when
 *  nothing matches; a patrol form reports patrols / static-shift rounds for
 *  any client; an alarm-response form reports callouts for any client and
 *  creates them only at Shurgard sites. Every form starts switched off. */
async function firstSeenDefaults(name: string) {
  if (/shurgard/i.test(name)) {
    const id = await shurgardId();
    return { customerId: id, createCustomerId: id, jobType: "ALARM_RESPONSE" as JobType };
  }
  if (/patrol/i.test(name)) return { jobType: "PATROL" as JobType };
  if (/alarm|call[\s-]?out/i.test(name)) {
    return { jobType: "ALARM_RESPONSE" as JobType, createCustomerId: await shurgardId() };
  }
  if (/vacant|\bvpi\b/i.test(name)) return { jobType: "VPI" as JobType };
  // A form named after one client is just for them.
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
        create: { formId, name, lastSeenAt: now, ...(await firstSeenDefaults(name)) },
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
 * and say which submissions are new and belong to a form that's on (or set to
 * Preview only, in a preview). Writes only the form list — and, for a preview
 * run, clears the forms' last-preview counts — never reports.
 */
export async function planFastField(
  input: PlanInput,
  preview: boolean,
  run?: string | null,
): Promise<PlanResult> {
  const forms = await ensureForms(input.forms);
  if (preview && run) {
    await prisma.fastFieldForm.updateMany({
      where: { mode: { not: "OFF" } },
      data: {
        previewRun: run,
        previewAt: new Date(),
        previewCounts: emptyCounts() as unknown as Prisma.InputJsonValue,
      },
    });
  }
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
  customers: CustomerRow[] | null;
  people: { active: PersonRow[]; inactive: PersonRow[] } | null;
  /** Preview only: activities already claimed by an earlier report in this
   *  run, and jobs it would have created. */
  claimed: Set<string>;
  virtual: { siteId: string; when: Date; type: string }[];
  /** Skipped places by siteKey (Admin → FastField → Skip). */
  skips: Map<string, { id: string; label: string }> | null;
};

function newCtx(): Ctx {
  return { sites: new Map(), customers: null, people: null, claimed: new Set(), virtual: [], skips: null };
}

async function skipsFor(ctx: Ctx): Promise<Map<string, { id: string; label: string }>> {
  if (!ctx.skips) {
    const rows = await prisma.fastFieldSkip.findMany({ select: { id: true, siteKey: true, label: true } });
    ctx.skips = new Map(rows.map((r) => [r.siteKey, { id: r.id, label: r.label }]));
  }
  return ctx.skips;
}

/** The skipped place a report that would wait belongs to, if any. A report
 *  that matches an activity is never skipped. */
async function skipFor(ctx: Ctx, d: Decision, siteText: string | null) {
  if (d.action !== "unmatched") return undefined;
  const key = siteKey(siteText);
  return key ? (await skipsFor(ctx)).get(key) : undefined;
}

/** Active clients, for a client named in a report's site ("Shurgard self
 *  storage Woolwich"). */
async function customersFor(ctx: Ctx): Promise<CustomerRow[]> {
  ctx.customers ??= await prisma.customer.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
  return ctx.customers;
}

/** Active sites to match against: one client's, or everyone's. */
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
      customerId: true,
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
    customerId: s.customerId,
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

/** Jobs and patrol visits at a site within the matching window (3 hours, or
 *  `windowMin`) either side of the report. */
async function candidatesNear(
  siteId: string,
  when: Date,
  windowMin: number = MATCH_WINDOW_MIN,
): Promise<ActivityCandidate[]> {
  const from = new Date(when.getTime() - windowMin * 60000);
  const to = new Date(when.getTime() + windowMin * 60000);
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

/** How far back a shift a report fits inside can have started. */
const SHIFT_REACH_MS = 36 * 3_600_000;

/** Static / dog-handler shifts at the sites that a report starting at `from`
 *  could fit: those that started (scheduled or actual) up to 36 hours before
 *  it — shifts can be long — or within the allowance after it, with their
 *  full window. */
async function shiftsNearSites(siteIds: string[], from: Date) {
  const range = {
    gte: new Date(from.getTime() - SHIFT_REACH_MS),
    lte: new Date(from.getTime() + SHIFT_GRACE_MIN * 60000),
  };
  return prisma.shift.findMany({
    where: { siteId: { in: siteIds }, OR: [{ scheduledStartsAt: range }, { actualStartedAt: range }] },
    select: {
      id: true,
      siteId: true,
      officerId: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      actualStartedAt: true,
      actualEndedAt: true,
    },
    take: 50,
  });
}

function toShiftCandidate(s: {
  id: string;
  officerId: string | null;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
}): ShiftCandidate {
  return {
    id: s.id,
    officerId: s.officerId,
    start: new Date(
      Math.min(s.scheduledStartsAt.getTime(), (s.actualStartedAt ?? s.scheduledStartsAt).getTime()),
    ),
    end: new Date(
      Math.max(s.scheduledEndsAt.getTime(), (s.actualEndedAt ?? s.scheduledEndsAt).getTime()),
    ),
  };
}

async function shiftsNear(siteId: string, from: Date): Promise<ShiftCandidate[]> {
  return (await shiftsNearSites([siteId], from)).map(toShiftCandidate);
}

/** Shifts at a site that come within MANUAL_LINK_WINDOW_MIN of a time, for
 *  linking by hand. */
async function shiftsForLinking(siteId: string, when: Date): Promise<ShiftCandidate[]> {
  const reach = MANUAL_LINK_WINDOW_MIN * 60000;
  const t = when.getTime();
  // A shift that ends within reach started at most a day before that.
  const range = { gte: new Date(t - reach - 24 * 3_600_000), lte: new Date(t + reach) };
  const rows = await prisma.shift.findMany({
    where: { siteId, OR: [{ scheduledStartsAt: range }, { actualStartedAt: range }] },
    select: {
      id: true,
      officerId: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      actualStartedAt: true,
      actualEndedAt: true,
    },
    take: 100,
  });
  return rows
    .map(toShiftCandidate)
    .filter((s) => s.end.getTime() >= t - reach && s.start.getTime() <= t + reach);
}

/**
 * Which of these sites had work on at the report's time: a static shift the
 * report fits inside, or a job or visit within 3 hours. Used when the form's
 * site fits several sites, or none but the phone was near some.
 */
async function sitesWithWorkOn(
  siteIds: string[],
  when: Date,
  span: ReportSpan,
): Promise<Set<string>> {
  if (siteIds.length === 0) return new Set();
  const range = {
    gte: new Date(when.getTime() - MATCH_WINDOW_MIN * 60000),
    lte: new Date(when.getTime() + MATCH_WINDOW_MIN * 60000),
  };
  const [shifts, jobs, visits] = await Promise.all([
    shiftsNearSites(siteIds, span.from),
    prisma.job.findMany({
      where: {
        siteId: { in: siteIds },
        status: { not: "CANCELLED" },
        handledByPartnerId: null,
        patrolVisitId: null,
        type: { notIn: NOT_MATCHABLE },
        OR: [{ scheduledFor: range }, { startedAt: range }, { completedAt: range }],
      },
      select: { siteId: true },
      take: 200,
    }),
    prisma.patrolVisit.findMany({
      where: {
        siteId: { in: siteIds },
        status: { not: "CANCELLED" },
        handledByPartnerId: null,
        OR: [{ scheduledAt: range }, { arrivedAt: range }],
      },
      select: { siteId: true },
      take: 200,
    }),
  ]);
  const out = new Set<string>();
  for (const sh of shifts) {
    if (shiftsOn(span, [toShiftCandidate(sh)]).length) out.add(sh.siteId);
  }
  for (const r of [...jobs, ...visits]) if (r.siteId) out.add(r.siteId);
  return out;
}

// ── Deciding what to do with a report ─────────────────────────────────────

export type UnmatchedReason = "site" | "none" | "taken" | "ambiguous" | "shift";

type LinkTarget = { kind: "job" | "visit" | "shift"; id: string; type: string };

type Decision =
  | { action: "link"; site: SiteRow; target: LinkTarget; note: string }
  | { action: "create"; site: SiteRow; type: JobType; note: string }
  | { action: "unmatched"; site: SiteRow | null; reason: UnmatchedReason; note: string };

function siteHow(how: SiteHow, distanceM: number | null): string {
  if (how === "activity") return " Site found by the work on there at the time.";
  if (how === "gps") return ` Site found by GPS (${Math.round(distanceM ?? 0)} m away).`;
  if (how === "postcode" || how === "postcode+name") return " Site found by postcode.";
  if (how === "postcode+gps") return " Site found by postcode and GPS.";
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
  const sp = pickSite(facts, sites, await customersFor(ctx));
  let site: SiteRow;
  let how: string;
  if (sp.site) {
    site = sp.site;
    how = siteHow(sp.how, sp.distanceM);
  } else {
    // The form's site fits several sites, or none but the phone was near
    // some: the one that had work on at the time.
    const active = await sitesWithWorkOn(
      sp.candidates.map((c) => c.id),
      facts.when,
      reportSpan(facts),
    );
    const byWork = pickSiteByActivity(facts, sp.candidates, active);
    if (!byWork) return { action: "unmatched", site: null, reason: "site", note: sp.reason };
    site = byWork;
    how = siteHow("activity", null);
  }
  const kind = (facts.visitType as JobType | null) ?? form.jobType;
  const at = formatDateTime(facts.when);
  // A report only goes on a shift it fits inside: it doesn't start before
  // the shift starts or finish after it ends.
  const span = reportSpan(facts);
  const shifts = await shiftsNear(site.id, span.from);
  const shiftsNow = shiftsOn(span, shifts);
  const officerId = await officerFor(ctx, facts);

  const toShift = (sh: ShiftCandidate, note: string): Decision => ({
    action: "link",
    site,
    target: { kind: "shift", id: sh.id, type: "SHIFT" },
    note: note + how,
  });
  const hours = (sh: ShiftCandidate) => `${formatTime(sh.start)}–${formatTime(sh.end)}`;
  const sharedNote = " It fitted two shifts; it went to the closer one.";

  // A patrol round during a static shift belongs to that shift.
  if (kind === "PATROL" && shiftsNow.length) {
    const ps = pickShift(span, shiftsNow, officerId);
    if (ps.pick) {
      return toShift(
        ps.pick,
        `Filed during the static shift at ${site.name} (${hours(ps.pick)}).${ps.shared ? sharedNote : ""}`,
      );
    }
  }

  let candidates = await candidatesNear(site.id, facts.when);
  if (preview) {
    candidates = candidates.map((c) => (ctx.claimed.has(c.id) ? { ...c, taken: true } : c));
    for (const v of ctx.virtual) {
      if (v.siteId === site.id) {
        candidates.push({ kind: "job", id: `virtual-${candidates.length}`, type: v.type, times: [v.when], taken: true });
      }
    }
  }

  let ap = pickActivity(facts.when, kind, candidates);
  // Nothing within 3 hours and no static shift on: a report filed late, or a
  // job logged at the wrong time — look for the same kind of work up to 18
  // hours either side.
  let wide = false;
  if (!ap.pick && ap.reason === "none" && !shiftsNow.length) {
    let far = await candidatesNear(site.id, facts.when, WIDE_MATCH_WINDOW_MIN);
    if (preview) far = far.map((c) => (ctx.claimed.has(c.id) ? { ...c, taken: true } : c));
    const wp = pickActivityWide(facts.when, kind, far, new Date());
    if (wp.pick) {
      ap = wp;
      wide = true;
    }
  }
  if (ap.pick) {
    const nearest = ap.pick.times.reduce((best, t) =>
      Math.abs(t.getTime() - facts.when.getTime()) < Math.abs(best.getTime() - facts.when.getTime()) ? t : best,
    );
    const close = ap.closeCall
      ? " Another activity was about as close, so it chose by the kind of work, then the nearer time."
      : "";
    return {
      action: "link",
      site,
      target: ap.pick,
      note:
        (wide
          ? `Matched to the ${noun(ap.pick.type)} at ${formatDateTime(nearest)} (${apartText(ap.minutesApart)} apart) — nothing was within 3 hours, so it took the nearest similar one within 18 hours.`
          : `Matched to the ${noun(ap.pick.type)} at ${formatTime(nearest)} (${ap.minutesApart} min apart).`) +
        close +
        how,
    };
  }

  // No job or visit to attach it to, but a static shift was on: the guard on
  // duty dealt with it, so it goes to the shift (no job is made, nothing is
  // billed twice).
  if (shiftsNow.length) {
    const ps = pickShift(span, shiftsNow, officerId);
    if (ps.pick) {
      return toShift(
        ps.pick,
        `Filed during the static shift at ${site.name} (${hours(ps.pick)}), with no other activity to attach it to.${ps.shared ? sharedNote : ""}`,
      );
    }
  }

  if (ap.reason === "none" && form.createCustomerId && site.customerId === form.createCustomerId) {
    return {
      action: "create",
      site,
      type: kind,
      note: `No activity at ${site.name} within 3 hours, nor a similar one within 18 hours to match it to, so the ${noun(kind)} was created.${how}`,
    };
  }
  const note =
    ap.reason === "none"
      ? `No activity at ${site.name} within 3 hours of ${at}, nor a similar one within 18 hours to match it to.`
      : `The activity at ${site.name} near ${at} already has a FastField report.`;
  return { action: "unmatched", site, reason: ap.reason, note: note + how };
}

// ── Import ────────────────────────────────────────────────────────────────

export type Counts = {
  linked: number;
  /** Linked, by what to (ALARM_RESPONSE, PATROL, LOCK, SHIFT, …). */
  linkedByType: Record<string, number>;
  created: number;
  unmatched: Record<UnmatchedReason, number>;
  /** Would have waited, but typed as a skipped place: set aside. */
  skipped: number;
};

export type ImportSummary = Counts & {
  received: number;
  alreadyImported: number;
  formOff: number;
  failed: number;
  /** The same counts per FastField form id. */
  byForm: Record<string, Counts>;
};

function emptyCounts(): Counts {
  return {
    linked: 0,
    linkedByType: {},
    created: 0,
    unmatched: { site: 0, none: 0, taken: 0, ambiguous: 0, shift: 0 },
    skipped: 0,
  };
}

function emptySummary(received: number): ImportSummary {
  return { ...emptyCounts(), received, alreadyImported: 0, formOff: 0, failed: 0, byForm: {} };
}

function addDecision(c: Counts, d: Decision) {
  if (d.action === "link") {
    c.linked++;
    c.linkedByType[d.target.type] = (c.linkedByType[d.target.type] ?? 0) + 1;
  } else if (d.action === "create") {
    c.created++;
  } else {
    c.unmatched[d.reason]++;
  }
}

function tally(summary: ImportSummary, d: Decision, formId: number) {
  addDecision(summary, d);
  const f = (summary.byForm[String(formId)] ??= emptyCounts());
  addDecision(f, d);
}

function tallySkipped(summary: ImportSummary, formId: number) {
  summary.skipped++;
  (summary.byForm[String(formId)] ??= emptyCounts()).skipped++;
}

function addCounts(into: Counts, from: Counts): Counts {
  into.linked += from.linked;
  into.created += from.created;
  into.skipped = (into.skipped ?? 0) + (from.skipped ?? 0);
  for (const [t, n] of Object.entries(from.linkedByType)) {
    into.linkedByType[t] = (into.linkedByType[t] ?? 0) + n;
  }
  for (const r of Object.keys(into.unmatched) as UnmatchedReason[]) {
    into.unmatched[r] += from.unmatched?.[r] ?? 0;
  }
  return into;
}

/** Add a preview batch's per-form counts to the forms' last-preview counts
 *  (a new run starts them again). Shown on Admin → FastField. */
async function recordPreview(run: string, byForm: Record<string, Counts>) {
  for (const [formId, counts] of Object.entries(byForm)) {
    const form = await prisma.fastFieldForm.findUnique({
      where: { formId: Number(formId) },
      select: { previewRun: true, previewCounts: true },
    });
    if (!form) continue;
    const base =
      form.previewRun === run && form.previewCounts && typeof form.previewCounts === "object"
        ? addCounts(emptyCounts(), form.previewCounts as unknown as Counts)
        : emptyCounts();
    await prisma.fastFieldForm.update({
      where: { formId: Number(formId) },
      data: {
        previewRun: run,
        previewAt: new Date(),
        previewCounts: addCounts(base, counts) as unknown as Prisma.InputJsonValue,
      },
    });
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
 * nothing, so a run can be repeated safely. With preview, no report is written
 * and the summary says what would happen (also kept per form under `run`).
 */
export async function importFastField(
  reports: FastFieldIncoming[],
  preview: boolean,
  run?: string | null,
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
      const skip = await skipFor(ctx, decision, facts.siteText);
      if (preview) {
        if (skip) tallySkipped(summary, form.formId);
        else tally(summary, decision, form.formId);
        if (decision.action === "link" && decision.target.kind !== "shift") {
          ctx.claimed.add(decision.target.id);
        }
        if (decision.action === "create") {
          ctx.virtual.push({ siteId: decision.site.id, when: facts.when, type: decision.type });
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
            status: skip ? "IGNORED" : "UNMATCHED",
            note: skip ? skipNote(skip.label) : decision.note,
            siteId: decision.site?.id ?? null,
            skipId: skip?.id ?? null,
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

      if (skip) {
        tallySkipped(summary, form.formId);
        continue;
      }
      await applyAndTally(ctx, row.id, decision, form.formId, summary);
    } catch (e) {
      console.error("FastField import failed for one report:", errCode(e));
      summary.failed++;
    }
  }
  if (preview && run) await recordPreview(run, summary.byForm);
  return summary;
}

/** Carry out a decision on a stored report. If attaching fails (the activity
 *  changed meanwhile), the report stays unmatched with the reason. */
async function applyAndTally(
  ctx: Ctx,
  reportId: string,
  decision: Decision,
  formId: number,
  summary: ImportSummary,
) {
  const applied = await applyDecision(ctx, reportId, decision);
  if (applied.ok) {
    tally(summary, decision, formId);
    return;
  }
  summary.failed++;
  await prisma.fastFieldReport.update({
    where: { id: reportId },
    data: { note: `Couldn't attach automatically: ${applied.error}` },
  });
}

async function applyDecision(ctx: Ctx, reportId: string, d: Decision): Promise<ActionResult> {
  if (d.action === "link") {
    if (d.target.kind === "shift") return linkReportToShift(reportId, d.target.id, { note: d.note, ctx });
    return d.target.kind === "job"
      ? linkReportToJob(reportId, d.target.id, { note: d.note, ctx })
      : linkReportToVisit(reportId, d.target.id, { note: d.note, ctx });
  }
  if (d.action === "create") {
    return createJobForReport(reportId, { siteId: d.site.id, type: d.type, note: d.note, ctx });
  }
  return { ok: true };
}

// ── Looking again at waiting reports ──────────────────────────────────────

/** Work recorded this far either side of a report's time can change its match. */
export const RECHECK_REACH_MS = 36 * 3_600_000;
/** Every waiting report is looked at again at least this often — the rules
 *  or the sites may have changed even when its own site's work hasn't. */
export const RECHECK_EVERY_MS = 24 * 3_600_000;
/** When the matching rules last changed. Move it forward with any change to
 *  how reports are matched, so every waiting report is tried again under the
 *  new rules (newest first) instead of keeping the note from the old ones. */
export const RULES_CHANGED_AT = new Date("2026-11-24T09:25:00Z");

export type WaitingReport = {
  id: string;
  siteId: string | null;
  /** When the work happened, roughly: opened on the phone, else filed. */
  at: Date;
  submittedAt: Date;
  /** When the robot last tried it (its import, if not since). */
  lastLook: Date;
};

/** A job, visit or shift added or changed: where, when it changed, and the
 *  stretch of time it covers. */
export type WorkChange = { siteId: string; changedAt: Date; from: Date; to: Date };

/**
 * Which waiting reports are worth trying again, best first:
 *   1. work at the report's site added or changed, near its time, since it
 *      was last tried — newest report first (a shift logged the morning after);
 *   2. any site added or changed since then (it may be the report's real
 *      site), or the matching rules — newest first;
 *   3. not tried for a day — longest-waiting first.
 * With `all`, every report comes after those, longest-untried first, so
 * pressing "Try matching again" repeatedly works through them all.
 */
export function dueForRecheck(
  rows: WaitingReport[],
  changes: WorkChange[],
  latestSiteChange: Date | null,
  now: Date,
  all = false,
): string[] {
  const bySite = new Map<string, WorkChange[]>();
  for (const c of changes) {
    const list = bySite.get(c.siteId) ?? [];
    list.push(c);
    bySite.set(c.siteId, list);
  }
  const newest = (a: WaitingReport, b: WaitingReport) =>
    b.submittedAt.getTime() - a.submittedAt.getTime();
  const longestUntried = (a: WaitingReport, b: WaitingReport) =>
    a.lastLook.getTime() - b.lastLook.getTime() || newest(a, b);

  const work: WaitingReport[] = [];
  const sites: WaitingReport[] = [];
  const stale: WaitingReport[] = [];
  const rest: WaitingReport[] = [];
  for (const r of rows) {
    const seen = r.lastLook.getTime();
    const t = r.at.getTime();
    const near = (bySite.get(r.siteId ?? "") ?? []).some(
      (c) =>
        c.changedAt.getTime() > seen &&
        c.from.getTime() - RECHECK_REACH_MS <= t &&
        t <= c.to.getTime() + RECHECK_REACH_MS,
    );
    if (near) work.push(r);
    else if (latestSiteChange && latestSiteChange.getTime() > seen) sites.push(r);
    else if (now.getTime() - seen >= RECHECK_EVERY_MS) stale.push(r);
    else rest.push(r);
  }
  return [
    ...work.sort(newest),
    ...sites.sort(newest),
    ...stale.sort(longestUntried),
    ...(all ? rest.sort(longestUntried) : []),
  ].map((r) => r.id);
}

/** The waiting reports filed in the last `sinceDays`, in the order to try them. */
async function dueReports(now: Date, sinceDays: number, all: boolean): Promise<string[]> {
  const rows = await prisma.fastFieldReport.findMany({
    where: {
      status: "UNMATCHED",
      // Taken off a shift by hand: left for a person.
      unlinkedAt: null,
      submittedAt: { gte: new Date(now.getTime() - sinceDays * 86_400_000) },
      form: { mode: "ON" },
    },
    select: {
      id: true,
      siteId: true,
      submittedAt: true,
      startedAt: true,
      checkedAt: true,
      createdAt: true,
    },
  });
  if (rows.length === 0) return [];
  const waiting: WaitingReport[] = rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    at: r.startedAt ?? r.submittedAt,
    submittedAt: r.submittedAt,
    lastLook: r.checkedAt ?? r.createdAt,
  }));
  const oldest = new Date(Math.min(...waiting.map((r) => r.lastLook.getTime())));
  const siteIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
  const atSites = { siteId: { in: siteIds } };
  const [jobs, shifts, visits, site] = await Promise.all([
    siteIds.length
      ? prisma.job.findMany({
          where: { ...atSites, updatedAt: { gt: oldest } },
          select: {
            siteId: true,
            updatedAt: true,
            createdAt: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
          },
        })
      : [],
    siteIds.length
      ? prisma.shift.findMany({
          where: { ...atSites, updatedAt: { gt: oldest } },
          select: {
            siteId: true,
            updatedAt: true,
            scheduledStartsAt: true,
            scheduledEndsAt: true,
            actualStartedAt: true,
            actualEndedAt: true,
          },
        })
      : [],
    siteIds.length
      ? prisma.patrolVisit.findMany({
          where: { ...atSites, createdAt: { gt: oldest } },
          select: { siteId: true, createdAt: true, scheduledAt: true },
        })
      : [],
    prisma.site.findFirst({
      where: { updatedAt: { gt: oldest } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const changes: WorkChange[] = [];
  for (const j of jobs) {
    if (!j.siteId) continue;
    const times = [j.scheduledFor, j.startedAt, j.completedAt].filter((x): x is Date => !!x);
    if (times.length === 0) times.push(j.createdAt);
    const ms = times.map((x) => x.getTime());
    changes.push({
      siteId: j.siteId,
      changedAt: j.updatedAt,
      from: new Date(Math.min(...ms)),
      to: new Date(Math.max(...ms)),
    });
  }
  for (const s of shifts) {
    changes.push({
      siteId: s.siteId,
      changedAt: s.updatedAt,
      from: new Date(Math.min(s.scheduledStartsAt.getTime(), (s.actualStartedAt ?? s.scheduledStartsAt).getTime())),
      to: new Date(Math.max(s.scheduledEndsAt.getTime(), (s.actualEndedAt ?? s.scheduledEndsAt).getTime())),
    });
  }
  for (const v of visits) {
    if (!v.siteId) continue;
    changes.push({ siteId: v.siteId, changedAt: v.createdAt, from: v.scheduledAt, to: v.scheduledAt });
  }
  const sitesOrRules =
    site && site.updatedAt.getTime() > RULES_CHANGED_AT.getTime() ? site.updatedAt : RULES_CHANGED_AT;
  return dueForRecheck(waiting, changes, sitesOrRules, now, all);
}

/** Try one waiting report again: attach it if it now matches, else note why
 *  not and when it was tried. False when it no longer needs trying. */
async function recheckOne(ctx: Ctx, id: string, summary: ImportSummary): Promise<boolean> {
  const row = await prisma.fastFieldReport.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      answers: true,
      unlinkedAt: true,
      form: { select: FORM_SELECT },
    },
  });
  if (!row || row.status !== "UNMATCHED" || row.form.mode !== "ON") return false;
  // Taken off a shift by hand: the robot never links it again.
  if (row.unlinkedAt) return false;
  const facts = extractFacts({
    submittedAt: row.submittedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    answers: row.answers as unknown as FastFieldAnswer[],
  });
  const decision = await decide(ctx, facts, row.form, false);
  if (decision.action === "unmatched") {
    await prisma.fastFieldReport.update({
      where: { id: row.id },
      data: { siteId: decision.site?.id ?? null, note: decision.note, checkedAt: new Date() },
    });
    tally(summary, decision, row.form.formId);
    return true;
  }
  await applyAndTally(ctx, row.id, decision, row.form.formId, summary);
  return true;
}

export type RetrySummary = ImportSummary & {
  /** Waiting reports tried this time. */
  checked: number;
  /** Reports due a try that the time ran out for — the next run carries on. */
  notReached: number;
  /** True when another copy of the matcher was already running, so this
   *  one did nothing (see RunLock). */
  busy?: boolean;
};

/**
 * Try waiting reports again — work may have been recorded since (a shift
 * logged the next morning), or a site added or fixed. Without ids it takes
 * the reports most likely to match now first (`dueForRecheck`), one at a
 * time, until the time budget is spent; each report tried is stamped, so the
 * next run carries on from there rather than retrying the same ones.
 */
export async function retryUnmatched(
  opts: { ids?: string[]; sinceDays?: number; all?: boolean; budgetMs?: number } = {},
): Promise<RetrySummary> {
  const started = Date.now();
  const ids =
    opts.ids ?? (await dueReports(new Date(), opts.sinceDays ?? 30, opts.all ?? false));
  const summary: RetrySummary = { ...emptySummary(0), checked: 0, notReached: 0 };
  const ctx = newCtx();
  let i = 0;
  // Always at least one, so even a short budget makes progress.
  for (; i < ids.length && (i === 0 || Date.now() - started < (opts.budgetMs ?? 40_000)); i++) {
    try {
      if (await recheckOne(ctx, ids[i], summary)) summary.checked++;
    } catch (e) {
      console.error("FastField retry failed for one report:", errCode(e));
      summary.failed++;
    }
  }
  summary.received = summary.checked;
  summary.notReached = ids.length - i;
  return summary;
}

// ── Review (read-only — the Claude connector's review_fastfield) ─────────

export type FastFieldReviewRow = {
  ref: string;
  filed: Date;
  /** The moment used for matching (arrival, else opened, else filed). */
  at: Date;
  form: string;
  siteTyped: string | null;
  site: string | null;
  /** The note the robot left when it last tried. */
  robotSaid: string | null;
  /** What the robot would do with it now (a dry run — nothing is written). */
  now: { would: "link" | "create" | "wait"; reason?: UnmatchedReason; note: string };
  /** Still waiting with a known site: work recorded there within 24 hours. */
  nearby?: {
    activities: { what: string; at: Date; hoursApart: number; reported: boolean }[];
    shifts: { start: Date; end: Date }[];
  };
  /** Still waiting with no site: the nearest site to the phone's GPS fix. */
  nearestSite?: { name: string; metres: number } | null;
};

export type FastFieldReview = {
  received: number;
  linked: { byRobot: number; byHand: number };
  created: { byRobot: number; byHand: number };
  setAside: number;
  waiting: number;
  /** Waiting reports dry-run through the current rules. */
  checked: number;
  wouldNow: { link: number; create: number; wait: Record<UnmatchedReason, number> };
  reports: FastFieldReviewRow[];
};

/**
 * How the FastField matching is doing for reports filed in [from, to]: the
 * robot's links and creations against those done by hand, and — for each
 * report still waiting — what the robot would do with it now and what work
 * is recorded at its site. Reads only; the dry run is decide() in preview.
 */
export async function reviewFastField(opts: {
  from: Date;
  to: Date;
  limit: number;
  /** Stop starting dry runs after this long (the caller has a time limit). */
  budgetMs?: number;
}): Promise<FastFieldReview> {
  const started = Date.now();
  const filed = { submittedAt: { gte: opts.from, lte: opts.to } };
  const [byStatus, linkedByHand, createdByHand, waitingRows] = await Promise.all([
    prisma.fastFieldReport.groupBy({ by: ["status"], where: filed, _count: { _all: true } }),
    prisma.fastFieldReport.count({ where: { ...filed, status: "LINKED", linkedByHand: true } }),
    prisma.fastFieldReport.count({ where: { ...filed, status: "CREATED", note: { contains: " created by " } } }),
    prisma.fastFieldReport.findMany({
      // Reports taken off a shift by hand wait for a person, not the robot.
      where: { ...filed, status: "UNMATCHED", unlinkedAt: null },
      orderBy: { submittedAt: "desc" },
      take: opts.limit,
      select: {
        id: true,
        note: true,
        siteText: true,
        submittedAt: true,
        startedAt: true,
        finishedAt: true,
        answers: true,
        form: { select: FORM_SELECT },
      },
    }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;

  const ctx = newCtx();
  const wouldNow = {
    link: 0,
    create: 0,
    wait: { site: 0, none: 0, taken: 0, ambiguous: 0, shift: 0 } as Record<UnmatchedReason, number>,
  };
  const rows: FastFieldReviewRow[] = [];
  const budget = opts.budgetMs ?? 40_000;

  async function review(r: (typeof waitingRows)[number]): Promise<FastFieldReviewRow> {
    const facts = extractFacts({
      submittedAt: r.submittedAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      answers: r.answers as unknown as FastFieldAnswer[],
    });
    const d = await decide(ctx, facts, r.form, true);
    const row: FastFieldReviewRow = {
      ref: r.id.slice(0, 8),
      filed: r.submittedAt,
      at: facts.when,
      form: r.form.name,
      siteTyped: (facts.siteText ?? r.siteText)?.slice(0, 80) ?? null,
      site: d.site?.name ?? null,
      robotSaid: r.note,
      now:
        d.action === "unmatched"
          ? { would: "wait", reason: d.reason, note: d.note }
          : { would: d.action, note: d.note },
    };
    if (d.action === "link") wouldNow.link++;
    else if (d.action === "create") wouldNow.create++;
    else wouldNow.wait[d.reason]++;
    if (d.action !== "unmatched") return row;

    if (d.site) {
      const [acts, shifts] = await Promise.all([
        candidatesNear(d.site.id, facts.when, 24 * 60),
        shiftsForLinking(d.site.id, facts.when),
      ]);
      const t = facts.when.getTime();
      row.nearby = {
        activities: acts
          .map((c) => {
            const at = c.times.reduce((best, x) =>
              Math.abs(x.getTime() - t) < Math.abs(best.getTime() - t) ? x : best,
            );
            return {
              what: noun(c.type),
              at,
              hoursApart: Math.round((at.getTime() - t) / 360_000) / 10,
              reported: c.taken,
            };
          })
          .sort((a, b) => Math.abs(a.hoursApart) - Math.abs(b.hoursApart))
          .slice(0, 6),
        shifts: shifts
          .filter((s) => s.end.getTime() >= t - 86_400_000 && s.start.getTime() <= t + 86_400_000)
          .slice(0, 4)
          .map((s) => ({ start: s.start, end: s.end })),
      };
    } else if (facts.lat != null && facts.lng != null) {
      let best: { name: string; metres: number } | null = null;
      for (const s of await sitesFor(ctx, null)) {
        if (s.lat == null || s.lng == null) continue;
        const m = haversineMeters(facts.lat, facts.lng, s.lat, s.lng);
        if (!best || m < best.metres) best = { name: s.name, metres: Math.round(m) };
      }
      row.nearestSite = best;
    } else {
      row.nearestSite = null;
    }
    return row;
  }

  // A few at a time: each dry run is several queries.
  const queue = [...waitingRows];
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      if (Date.now() - started > budget) return;
      rows.push(await review(r));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  rows.sort((a, b) => b.filed.getTime() - a.filed.getTime());

  return {
    received: byStatus.reduce((n, b) => n + b._count._all, 0),
    linked: { byRobot: count("LINKED") - linkedByHand, byHand: linkedByHand },
    created: { byRobot: count("CREATED") - createdByHand, byHand: createdByHand },
    setAside: count("IGNORED"),
    waiting: count("UNMATCHED"),
    checked: rows.length,
    wouldNow,
    reports: rows,
  };
}

// ── Attaching (automatic and by hand) ─────────────────────────────────────

export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** Why an attach or unlink was refused, for the robot's runs (e.g.
       *  "FF_ATTACHED", "FF_SET_ASIDE", "FF_TAKEN_OFF": the report isn't
       *  the robot's to change — leave its note alone). */
      code?: string;
    };

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

/** A report not yet on anything, read for its answers. Only a first look:
 *  what makes sure it's still free is the attach's claim (claimReport),
 *  inside its transaction. */
async function loadOpenReport(reportId: string): Promise<StoredReport | { error: string; code: string }> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: REPORT_SELECT,
  });
  if (!report) return { error: "FastField report not found.", code: "FF_NOT_FOUND" };
  if (report.formSubmissionId || report.status === "LINKED" || report.status === "CREATED") {
    return { error: "This FastField report is already attached to an activity.", code: "FF_ATTACHED" };
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
  target: {
    form: string;
    siteId: string | null;
    jobId?: string;
    patrolVisitId?: string;
    shiftId?: string;
  },
  officerId: string | null,
): Promise<string> {
  const { arrived, departed } = visitTimes(facts, report);
  const sub = await tx.formSubmission.create({
    data: {
      form: target.form as any,
      siteId: target.siteId,
      jobId: target.jobId ?? null,
      patrolVisitId: target.patrolVisitId ?? null,
      shiftId: target.shiftId ?? null,
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

/** A refusal inside an attach or unlink: its whole transaction rolls back,
 *  and `message` goes to the person (or into the robot's note). Only `code`
 *  is ever logged. */
class AttachRefused extends Error {
  readonly code: string;
  constructor(message: string, code = "FF_REFUSED") {
    super(message);
    this.name = "AttachRefused";
    this.code = code;
  }
}

const ALREADY_ATTACHED = "This FastField report is already attached to an activity.";
const CHANGED_MEANWHILE =
  "This report changed while you were looking at it — refresh the page and try again.";

/** How long one attach or unlink may keep its rows locked. */
const ATTACH_TX_MS = 15_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run one attach or unlink as a single transaction: all of it, or — on a
 *  refusal or any error — none of it. `now` is taken before anything is read. */
async function inAttachTx<T>(
  fn: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string; code: string }> {
  const now = new Date();
  try {
    const value = await prisma.$transaction((tx) => fn(tx, now), { timeout: ATTACH_TX_MS });
    return { ok: true, value };
  } catch (e) {
    if (e instanceof AttachRefused) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
}

/**
 * The first step of every attach: take the report, inside the attach's
 * transaction. Only a waiting report with no round on anything can be taken.
 * A person can take one that's waiting or set aside, whatever happened to it
 * before. The robot only takes a waiting one, and never one a person took
 * off an activity; one the robot took off itself it only puts back on a
 * shift (`onto` "shift"), never a job or visit. The update locks the
 * report's row, so a second attach of the same report waits here, then finds
 * it taken and rolls back: one report, one activity, one round.
 */
async function claimReport(
  tx: Prisma.TransactionClient,
  reportId: string,
  status: "LINKED" | "CREATED",
  byHand: boolean,
  onto: "shift" | "activity",
): Promise<void> {
  const claimed = await tx.fastFieldReport.updateMany({
    where: {
      id: reportId,
      formSubmissionId: null,
      ...(byHand
        ? { status: { in: ["UNMATCHED", "IGNORED"] } }
        : {
            status: "UNMATCHED",
            ...(onto === "shift" ? { OR: [{ unlinkedAt: null }, { unlinkedBy: "ROBOT" }] } : { unlinkedAt: null }),
          }),
    },
    data: { status },
  });
  if (claimed.count === 1) return;
  const now = await tx.fastFieldReport.findUnique({
    where: { id: reportId },
    select: { status: true, unlinkedBy: true },
  });
  if (!now) throw new AttachRefused("FastField report not found.");
  if (now.status === "IGNORED") {
    throw new AttachRefused("This report was set aside, so the robot leaves it.", "FF_SET_ASIDE");
  }
  if (now.status === "UNMATCHED" && now.unlinkedBy === "PERSON") {
    throw new AttachRefused("A person took this report off its activity, so the robot leaves it.", "FF_TAKEN_OFF");
  }
  if (now.status === "UNMATCHED" && now.unlinkedBy === "ROBOT") {
    throw new AttachRefused(
      "The robot took this report off a shift, so it only puts it back on a shift it fits.",
      "FF_TAKEN_OFF",
    );
  }
  throw new AttachRefused(ALREADY_ATTACHED, "FF_ATTACHED");
}

/** Lock a job or visit row (FOR UPDATE), or a shift row (FOR SHARE), until
 *  the transaction ends: what's read next is current, and nobody changes it
 *  meanwhile. False when it doesn't exist. */
async function lockRow(
  tx: Prisma.TransactionClient,
  table: "Job" | "PatrolVisit" | "Shift",
  id: string,
): Promise<boolean> {
  const mode = table === "Shift" ? "SHARE" : "UPDATE";
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id}::uuid FOR ${Prisma.raw(mode)}`,
  );
  return rows.length > 0;
}

/**
 * The robot puts one report on a job or visit: refuse when it already has
 * another FastField report (what candidatesNear calls "taken") or a FastField
 * round with no report behind it. Read under the row lock, so two reports
 * linked to it at the same moment can't both get on. A person may add a
 * second report by hand.
 */
async function refuseIfTaken(
  tx: Prisma.TransactionClient,
  on: { jobId: string } | { patrolVisitId: string },
  reportId: string,
  what: string,
): Promise<void> {
  const reports = await tx.fastFieldReport.count({ where: { ...on, id: { not: reportId } } });
  const rounds = reports
    ? 0
    : await tx.formSubmission.count({
        where: { ...on, payload: { path: ["source"], equals: "fastfield" } },
      });
  if (reports + rounds > 0) {
    throw new AttachRefused(
      `That ${what} already has a FastField report — link this one by hand if it's a second report for it.`,
      "FF_TAKEN",
    );
  }
}

/** Set by every link and create: when, whether a person did it, under which
 *  rules — and it's no longer "taken off". */
const linkStamps = (byHand: boolean, now: Date) => ({
  linkedAt: now,
  linkedByHand: byHand,
  unlinkedAt: null,
  unlinkedBy: null,
  rulesVersion: FASTFIELD_RULES_VERSION,
});

/** The report's note after a link: the caller's note, plus `extra`. */
function linkNote(note: string | undefined, extra: string | null): { note?: string } {
  const text = [note, extra].filter(Boolean).join(" ");
  return text ? { note: text } : {};
}

const leftCancelled = (what: string) =>
  `The ${what} is cancelled, so it was left as it is: not marked done, billed or paid.`;

function reportFill(report: StoredReport, facts: FastFieldFacts, officerId: string | null): ReportFill {
  const { arrived, done } = visitTimes(facts, report);
  return {
    arrived,
    done,
    lat: facts.lat,
    lng: facts.lng,
    locatedAt: arrived ?? report.submittedAt,
    officerId,
    photoUrls: report.photoUrls,
  };
}

function addFinance(prev: LinkPrev, f: FinanceFilled) {
  if (f.billed) prev.filled.bill = true;
  if (f.paid) prev.filled.pay = true;
}

/** The attach's line on the activity's history (`fastfield_linked` /
 *  `fastfield_created`): who (no user = the robot), and exactly what it
 *  changed (`prev`), which Unlink reads to undo it. Ids, times and flags
 *  only. */
async function logAttach(
  tx: Prisma.TransactionClient,
  action: "fastfield_linked" | "fastfield_created",
  entity: "Job" | "PatrolVisit" | "Shift",
  entityId: string,
  reportId: string,
  byHand: boolean,
  prev: LinkPrev | Record<string, never>,
  userId: string | undefined,
): Promise<void> {
  await logActivity({
    client: tx,
    entity,
    entityId,
    action,
    userId: userId ?? null,
    diff: { fastfieldReportId: reportId, byHand, prev },
  });
}

/**
 * Attach a report to a job and mark the job done with the officer's times,
 * billed and paid — one transaction, so it all happens or none of it does.
 * The robot never puts a report on a cancelled job, or on one that already
 * has a report; a person can (a cancelled job then stays exactly as it is).
 */
export async function linkReportToJob(
  reportId: string,
  jobId: string,
  opts: { note?: string; ctx?: Ctx; byHand?: boolean; byUserId?: string } = {},
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error, code: report.code };
  if (!UUID_RE.test(jobId)) return { ok: false, error: "Activity not found." };
  const byHand = !!opts.byHand;
  const facts = factsOf(report);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  const fill = reportFill(report, facts, officerId);

  const res = await inAttachTx(async (tx, now) => {
    await claimReport(tx, report.id, "LINKED", byHand, "activity");
    if (!(await lockRow(tx, "Job", jobId))) throw new AttachRefused("Activity not found.");
    const job = await tx.job.findUniqueOrThrow({
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
    const what = noun(job.type);
    if (!byHand) {
      if (job.status === "CANCELLED") throw new AttachRefused("That activity was cancelled.", "FF_CANCELLED");
      await refuseIfTaken(tx, { jobId: job.id }, report.id, what);
    }
    const { data, prev } = planJobLink(job, fill, UNFINISHED.includes(job.status));
    if (Object.keys(data).length > 0) {
      const changed = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data });
      if (changed.count !== 1) throw new AttachRefused("That activity changed meanwhile — try again.", "FF_CHANGED");
    }
    if (!prev.cancelled) addFinance(prev, await fillJobFinance(job.id, tx));
    const submissionId = await createSubmission(
      tx,
      report,
      facts,
      { form: SUBMISSION_FORM[job.type] ?? "ADHOC", siteId: job.siteId, jobId: job.id },
      officerId,
    );
    await tx.fastFieldReport.update({
      where: { id: report.id },
      data: {
        jobId: job.id,
        siteId: job.siteId,
        formSubmissionId: submissionId,
        ...linkStamps(byHand, now),
        ...linkNote(opts.note, prev.cancelled ? leftCancelled(what) : null),
      },
    });
    await logAttach(tx, "fastfield_linked", "Job", job.id, report.id, byHand, prev, opts.byUserId);
  });
  return res.ok ? { ok: true } : res;
}

/**
 * Attach a report to a patrol visit and complete it, billed and paid like an
 * officer's own report — one transaction. A VPI schedule's visit is filed and
 * priced as a VPI, any other as a patrol (as snapshotVisitFinanceIfNeeded
 * does). The robot never puts a report on a cancelled visit, or on one that
 * already has a report; a person can (a cancelled visit stays as it is).
 */
export async function linkReportToVisit(
  reportId: string,
  visitId: string,
  opts: { note?: string; ctx?: Ctx; byHand?: boolean; byUserId?: string } = {},
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error, code: report.code };
  if (!UUID_RE.test(visitId)) return { ok: false, error: "Patrol visit not found." };
  const byHand = !!opts.byHand;
  const facts = factsOf(report);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  const fill = reportFill(report, facts, officerId);

  const res = await inAttachTx(async (tx, now) => {
    await claimReport(tx, report.id, "LINKED", byHand, "activity");
    if (!(await lockRow(tx, "PatrolVisit", visitId))) throw new AttachRefused("Patrol visit not found.");
    const visit = await tx.patrolVisit.findUniqueOrThrow({
      where: { id: visitId },
      select: {
        id: true,
        siteId: true,
        status: true,
        officerId: true,
        arrivedAt: true,
        departedAt: true,
        lat: true,
        photoUrls: true,
        handledByPartnerId: true,
        patrolSchedule: { select: { kind: true } },
      },
    });
    const kind = visitKind(visit.patrolSchedule?.kind);
    const what = noun(kind);
    if (!byHand) {
      if (visit.status === "CANCELLED") throw new AttachRefused("That visit was cancelled.", "FF_CANCELLED");
      await refuseIfTaken(tx, { patrolVisitId: visit.id }, report.id, what);
    }
    const { data, prev } = planVisitLink(visit, fill, VISIT_UNFINISHED.includes(visit.status));
    if (Object.keys(data).length > 0) {
      const changed = await tx.patrolVisit.updateMany({ where: { id: visit.id, status: visit.status }, data });
      if (changed.count !== 1) throw new AttachRefused("That visit changed meanwhile — try again.", "FF_CHANGED");
    }
    // Billing + pay where the visit has none yet, at its accounting date.
    if (!prev.cancelled) addFinance(prev, await fillVisitFinance(visit.id, tx));
    const submissionId = await createSubmission(
      tx,
      report,
      facts,
      { form: kind, siteId: visit.siteId, patrolVisitId: visit.id },
      officerId,
    );
    await tx.fastFieldReport.update({
      where: { id: report.id },
      data: {
        patrolVisitId: visit.id,
        siteId: visit.siteId,
        formSubmissionId: submissionId,
        ...linkStamps(byHand, now),
        ...linkNote(opts.note, prev.cancelled ? leftCancelled(what) : null),
      },
    });
    await logAttach(tx, "fastfield_linked", "PatrolVisit", visit.id, report.id, byHand, prev, opts.byUserId);
  });
  return res.ok ? { ok: true } : res;
}

/** Attach a patrol report to a static / dog-handler shift. The shift itself is
 *  left as it is — its own check-ins, times and pay stand; the report is extra
 *  evidence (and its photos appear in the client's static-guarding report).
 *  The robot only uses a shift the report fits; a person can pick any shift.
 *  A shift takes any number of reports. */
export async function linkReportToShift(
  reportId: string,
  shiftId: string,
  opts: { note?: string; ctx?: Ctx; byHand?: boolean; byUserId?: string } = {},
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error, code: report.code };
  if (!UUID_RE.test(shiftId)) return { ok: false, error: "Shift not found." };
  const byHand = !!opts.byHand;
  const facts = factsOf(report);
  const span = reportSpan(facts);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);

  // `now` is taken before the shift is read, so a shift edited after that
  // read is newer than the stamp and the shift check looks again.
  const res = await inAttachTx(async (tx, now) => {
    await claimReport(tx, report.id, "LINKED", byHand, "shift");
    if (!(await lockRow(tx, "Shift", shiftId))) throw new AttachRefused("Shift not found.");
    const shift = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      select: {
        id: true,
        siteId: true,
        officerId: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        actualStartedAt: true,
        actualEndedAt: true,
      },
    });
    // The robot only puts a report on a shift it fits (within the shift,
    // give or take the allowance).
    const window = toShiftCandidate(shift);
    const fit = shiftFit(span, window);
    if (!byHand && !fit.fits) {
      throw new AttachRefused(
        `This report (${spanText(span)}) ${outsideShiftText(fit)} (${shiftHoursText(
          window,
        )}), more than the ${SHIFT_GRACE_MIN} minutes allowed. A report can only go on a shift it fits.`,
        "FF_NO_FIT",
      );
    }
    const submissionId = await createSubmission(
      tx,
      report,
      facts,
      { form: "PATROL", siteId: shift.siteId, shiftId: shift.id },
      officerId,
    );
    await tx.fastFieldReport.update({
      where: { id: report.id },
      data: {
        shiftId: shift.id,
        siteId: shift.siteId,
        // It fits (checked above), or a person chose it: the check skips it.
        shiftCheckedAt: now,
        formSubmissionId: submissionId,
        ...linkStamps(byHand, now),
        ...linkNote(opts.note, null),
      },
    });
    await logAttach(tx, "fastfield_linked", "Shift", shift.id, report.id, byHand, {}, opts.byUserId);
  });
  return res.ok ? { ok: true } : res;
}

/** Create the completed job a report describes (a callout nobody logged)
 *  and attach the report to it — one transaction: the job is only made once
 *  the report is taken for it, so the same report never makes two jobs.
 *  `byHand` defaults to whether a person (`byUserId`) asked for it. */
export async function createJobForReport(
  reportId: string,
  opts: { siteId: string; type?: JobType; note?: string; ctx?: Ctx; byUserId?: string; byHand?: boolean },
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error, code: report.code };
  if (!UUID_RE.test(opts.siteId)) return { ok: false, error: "Site not found." };
  const site = await prisma.site.findUnique({
    where: { id: opts.siteId },
    select: { id: true, name: true, customerId: true, partnerId: true, active: true },
  });
  if (!site) return { ok: false, error: "Site not found." };
  if (!site.active) return { ok: false, error: "That site is inactive." };

  const byHand = opts.byHand ?? opts.byUserId != null;
  const facts = factsOf(report);
  const type = opts.type ?? (facts.visitType as JobType | null) ?? report.form.jobType;
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  const { arrived, done } = visitTimes(facts, report);

  const res = await inAttachTx(async (tx, now) => {
    await claimReport(tx, report.id, "CREATED", byHand, "activity");
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
    const prev: LinkPrev = { statusAfter: "APPROVED", filled: {} };
    addFinance(prev, await fillJobFinance(job.id, tx));
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
        jobCreated: true,
        jobId: job.id,
        siteId: site.id,
        formSubmissionId: submissionId,
        ...linkStamps(byHand, now),
        note: opts.note ?? `The ${noun(type)} at ${site.name} was created from this report.`,
      },
    });
    await logAttach(tx, "fastfield_created", "Job", job.id, report.id, byHand, prev, opts.byUserId);
  });
  return res.ok ? { ok: true } : res;
}

/** What a brought-back report waits for, by who took it off its activity. */
function broughtBackNote(unlinkedBy: FastFieldUnlinkBy | null): string {
  if (unlinkedBy === "PERSON") {
    return "Brought back. A person took it off its activity, so it waits for you: link it to the right activity or set it aside.";
  }
  if (unlinkedBy === "ROBOT") {
    return "Brought back. The robot puts it back on a shift it fits; otherwise it waits for you to link it.";
  }
  return "Brought back. The robot tries matching it again.";
}

/** Set a report aside (a test, a duplicate) or bring it back. Only a report
 *  that isn't on anything: the update is conditional, so a report attached
 *  at the same moment is never set aside. Bringing one back takes it out of
 *  its skipped place and clears `checkedAt`, so the robot looks at it again
 *  soon (as far as the rules let it — see the note). */
export async function setReportIgnored(
  reportId: string,
  ignored: boolean,
  note?: string,
): Promise<ActionResult> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: { status: true, unlinkedBy: true },
  });
  if (!report) return { ok: false, error: "FastField report not found." };
  if (report.status === "LINKED" || report.status === "CREATED") {
    return { ok: false, error: "This report is already attached to an activity." };
  }
  const done = await prisma.fastFieldReport.updateMany({
    where: { id: reportId, status: { in: ["UNMATCHED", "IGNORED"] }, formSubmissionId: null },
    data: ignored
      ? { status: "IGNORED", ...(note ? { note } : {}) }
      : {
          status: "UNMATCHED",
          // Brought back on its own, it no longer belongs to a skipped place.
          skipId: null,
          checkedAt: null,
          note: note ?? broughtBackNote(report.unlinkedBy),
        },
  });
  if (done.count !== 1) return { ok: false, error: "This report is already attached to an activity." };
  return { ok: true };
}

/** Tell the person when a report they took off had already gone to the
 *  client: taking it off doesn't take it back. */
const sentLine = (how: string | undefined) =>
  `This report had already gone to the client${how ? ` ${how}` : ""} — taking it off doesn't take it back, so let them know if it was wrong.`;

/**
 * Take a report off its shift by hand. The patrol round it added to the shift
 * goes (its FormSubmission and approved review), and the report goes back to
 * Needs linking, stamped `unlinkedAt` / `unlinkedBy` = PERSON so the robot
 * never puts it back: a person links it elsewhere or sets it aside. Linking a
 * report to a shift changes no billing, so there's nothing to undo there. A
 * report that already went to the client can still come off; `check` says so.
 * The shift's history line is the caller's (Admin → FastField → Unlink).
 */
export async function unlinkReportFromShift(
  reportId: string,
  by: string,
): Promise<ActionResult & { check?: string[] }> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      status: true,
      shiftId: true,
      formSubmissionId: true,
      shift: { select: { scheduledStartsAt: true } },
    },
  });
  if (!report) return { ok: false, error: "FastField report not found." };
  if (report.status !== "LINKED" || !report.shiftId) {
    return { ok: false, error: "This report isn't on a shift." };
  }
  const sent = await sentToClient(report);
  const which = report.shift ? ` that started ${formatDateTime(report.shift.scheduledStartsAt)},` : "";
  try {
    await takeOffShift(
      { id: report.id, formSubmissionId: report.formSubmissionId, reviewId: null, shiftId: report.shiftId },
      `Taken off the shift${which} by ${by}. The robot won't link it again: link it to the right activity or set it aside.`,
      { by: "PERSON" },
    );
  } catch (e) {
    if (e instanceof AttachRefused) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
  return { ok: true, check: sent.sent ? [sentLine(sent.how)] : [] };
}

const UNLINK_SELECT = {
  id: true,
  status: true,
  shiftId: true,
  jobId: true,
  patrolVisitId: true,
  formSubmissionId: true,
  photoUrls: true,
  job: { select: { id: true, type: true, scheduledFor: true, completedAt: true, createdAt: true } },
  patrolVisit: { select: { id: true, scheduledAt: true, patrolSchedule: { select: { kind: true } } } },
} as const;

type UnlinkReport = Prisma.FastFieldReportGetPayload<{ select: typeof UNLINK_SELECT }>;

/**
 * Take a report off whatever it is attached to, by a person (`by` = their
 * name for the note, `opts.byUserId` for the history): a shift, a job, a
 * patrol visit, or the job it made.
 *  - A shift: `unlinkReportFromShift` (the caller writes the shift's history
 *    line, as before).
 *  - A job or visit: its round goes, and what the link changed is put back
 *    from the link's history (`fastfield_linked` → prev) where that's safe —
 *    see planUnlinkUndo (fastfieldAttach.ts). Links made before linking kept
 *    a record change nothing on the activity.
 *  - The job it made: cancelled with its bill and pay cleared, as Cancel
 *    does, unless that isn't safe — see planCreatedJobUndo.
 * The report waits in Needs linking (`unlinkedBy` = PERSON: never re-linked
 * by the robot), and the job / visit gets a `fastfield_unlinked` history
 * line. `check` lists what the person should look at afterwards.
 */
export async function unlinkReportFromActivity(
  reportId: string,
  by: string,
  opts: { byUserId?: string } = {},
): Promise<ActionResult & { check?: string[] }> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: UNLINK_SELECT,
  });
  if (!report) return { ok: false, error: "FastField report not found." };
  const userId = opts.byUserId ?? null;
  if (report.status === "LINKED" && report.shiftId) return unlinkReportFromShift(reportId, by);
  if ((report.status === "LINKED" || report.status === "CREATED") && report.job) {
    return unlinkFromJob(report, report.job, by, userId);
  }
  if (report.status === "LINKED" && report.patrolVisit) {
    return unlinkFromVisit(report, report.patrolVisit, by, userId);
  }
  return { ok: false, error: "This report isn't attached to an activity." };
}

/** The latest `fastfield_linked` history of this report on this activity. */
async function linkHistory(entity: "Job" | "PatrolVisit", entityId: string, reportId: string): Promise<unknown> {
  const row = await prisma.activityLog.findFirst({
    where: { entity, entityId, action: "fastfield_linked", diff: { path: ["fastfieldReportId"], equals: reportId } },
    orderBy: { createdAt: "desc" },
    select: { diff: true },
  });
  return row?.diff ?? null;
}

/** The first step of an unlink, in its transaction: take the report off —
 *  only if it's still on this activity with this round (else roll back). */
async function claimForUnlink(
  tx: Prisma.TransactionClient,
  report: UnlinkReport,
  on: { jobId: string } | { patrolVisitId: string },
): Promise<void> {
  const taken = await tx.fastFieldReport.updateMany({
    where: { id: report.id, status: report.status, formSubmissionId: report.formSubmissionId, ...on },
    data: { status: "UNMATCHED" },
  });
  if (taken.count !== 1) throw new AttachRefused(CHANGED_MEANWHILE, "FF_CHANGED");
}

/** The last steps of an unlink: the report waits for a person, and its
 *  round (submission + review) goes. */
async function finishUnlink(
  tx: Prisma.TransactionClient,
  report: UnlinkReport,
  now: Date,
  note: string,
): Promise<void> {
  await tx.fastFieldReport.update({
    where: { id: report.id },
    data: {
      jobId: null,
      patrolVisitId: null,
      shiftId: null,
      formSubmissionId: null,
      jobCreated: false,
      linkedAt: null,
      linkedByHand: false,
      unlinkedAt: now,
      unlinkedBy: "PERSON",
      checkedAt: now,
      rulesVersion: FASTFIELD_RULES_VERSION,
      note,
    },
  });
  await removeRound(tx, report.formSubmissionId);
}

/** Delete a report's round: its FormSubmission and review. */
async function removeRound(tx: Prisma.TransactionClient, submissionId: string | null): Promise<void> {
  if (!submissionId) return;
  await tx.reportReview.deleteMany({ where: { submissionId } });
  await tx.formSubmission.deleteMany({ where: { id: submissionId } });
}

/** Other reports on a job or visit besides the one coming off: FastField
 *  reports, and any other submission (an officer's own report included). */
async function otherReportsOn(
  tx: Prisma.TransactionClient,
  on: { jobId: string } | { patrolVisitId: string },
  report: UnlinkReport,
): Promise<number> {
  const reports = await tx.fastFieldReport.count({ where: { ...on, id: { not: report.id } } });
  const rounds = await tx.formSubmission.count({
    where: { ...on, ...(report.formSubmissionId ? { id: { not: report.formSubmissionId } } : {}) },
  });
  return reports + rounds;
}

const NOT_AGAIN = "The robot won't link it again: link it to the right activity or set it aside.";

async function unlinkFromJob(
  report: UnlinkReport,
  job: NonNullable<UnlinkReport["job"]>,
  by: string,
  userId: string | null,
): Promise<ActionResult & { check?: string[] }> {
  const created = report.status === "CREATED";
  const what = noun(job.type);
  const when = formatDateTime(job.scheduledFor ?? job.completedAt ?? job.createdAt);
  const [sent, linked] = await Promise.all([
    sentToClient(report),
    created ? Promise.resolve(null) : linkHistory("Job", job.id, report.id),
  ]);
  const prev = readLinkPrev(linked);

  const res = await inAttachTx(async (tx, now) => {
    await claimForUnlink(tx, report, { jobId: job.id });
    await lockRow(tx, "Job", job.id);
    const j = await tx.job.findUniqueOrThrow({
      where: { id: job.id },
      select: {
        status: true,
        startedAt: true,
        completedAt: true,
        locatedAt: true,
        assignedToUserId: true,
        responderType: true,
        billedAmount: true,
        paidAmount: true,
        invoice: { select: { number: true } },
      },
    });
    const otherReports = await otherReportsOn(tx, { jobId: job.id }, report);
    const money = {
      billed: j.billedAmount != null,
      paid: j.paidAmount != null,
      invoiceNumber: j.invoice?.number ?? null,
      otherReports,
    };
    const plan = created
      ? planCreatedJobUndo(`the ${what} made from this report`, { status: j.status, ...money }, { userId, at: now })
      : planUnlinkUndo("job", `the ${what}`, prev, {
          status: j.status,
          times: { startedAt: j.startedAt, completedAt: j.completedAt },
          locatedAt: j.locatedAt,
          officerId: j.assignedToUserId,
          responderType: j.responderType,
          ...money,
        });
    if (Object.keys(plan.data).length > 0) {
      const changed = await tx.job.updateMany({ where: { id: job.id, status: j.status }, data: plan.data });
      if (changed.count !== 1) throw new AttachRefused(CHANGED_MEANWHILE, "FF_CHANGED");
    }
    const cancelled = plan.undone.includes("cancelled") ? `, and that ${what} was cancelled` : "";
    await finishUnlink(
      tx,
      report,
      now,
      created
        ? `Taken off the ${what} made from it (${when}) by ${by}${cancelled}. ${NOT_AGAIN}`
        : `Taken off the ${what} (${when}) by ${by}. ${NOT_AGAIN}`,
    );
    await logActivity({
      client: tx,
      entity: "Job",
      entityId: job.id,
      action: "fastfield_unlinked",
      userId,
      diff: { fastfieldReportId: report.id, by: "person", undone: plan.undone, ...(sent.sent ? { sentToClient: true } : {}) },
    });
    return plan.check;
  });
  if (!res.ok) return res;
  return { ok: true, check: [...(sent.sent ? [sentLine(sent.how)] : []), ...res.value] };
}

async function unlinkFromVisit(
  report: UnlinkReport,
  visit: NonNullable<UnlinkReport["patrolVisit"]>,
  by: string,
  userId: string | null,
): Promise<ActionResult & { check?: string[] }> {
  const what = noun(visitKind(visit.patrolSchedule?.kind));
  const [sent, linked] = await Promise.all([
    sentToClient(report),
    linkHistory("PatrolVisit", visit.id, report.id),
  ]);
  const prev = readLinkPrev(linked);

  const res = await inAttachTx(async (tx, now) => {
    await claimForUnlink(tx, report, { patrolVisitId: visit.id });
    await lockRow(tx, "PatrolVisit", visit.id);
    const v = await tx.patrolVisit.findUniqueOrThrow({
      where: { id: visit.id },
      select: {
        status: true,
        arrivedAt: true,
        departedAt: true,
        locatedAt: true,
        officerId: true,
        photoUrls: true,
        billedAmount: true,
        paidAmount: true,
        invoice: { select: { number: true } },
      },
    });
    const plan = planUnlinkUndo("visit", `the ${what}`, prev, {
      status: v.status,
      times: { arrivedAt: v.arrivedAt, departedAt: v.departedAt },
      locatedAt: v.locatedAt,
      officerId: v.officerId,
      photosAreReports:
        v.photoUrls.length === report.photoUrls.length && v.photoUrls.every((u, i) => u === report.photoUrls[i]),
      billed: v.billedAmount != null,
      paid: v.paidAmount != null,
      invoiceNumber: v.invoice?.number ?? null,
      otherReports: await otherReportsOn(tx, { patrolVisitId: visit.id }, report),
    });
    if (Object.keys(plan.data).length > 0) {
      const changed = await tx.patrolVisit.updateMany({ where: { id: visit.id, status: v.status }, data: plan.data });
      if (changed.count !== 1) throw new AttachRefused(CHANGED_MEANWHILE, "FF_CHANGED");
    }
    await finishUnlink(tx, report, now, `Taken off the ${what} (${formatDateTime(visit.scheduledAt)}) by ${by}. ${NOT_AGAIN}`);
    await logActivity({
      client: tx,
      entity: "PatrolVisit",
      entityId: visit.id,
      action: "fastfield_unlinked",
      userId,
      diff: { fastfieldReportId: report.id, by: "person", undone: plan.undone, ...(sent.sent ? { sentToClient: true } : {}) },
    });
    return plan.check;
  });
  if (!res.ok) return res;
  return { ok: true, check: [...(sent.sent ? [sentLine(sent.how)] : []), ...res.value] };
}

/**
 * Take a report off its shift: its patrol round (submission + review) goes,
 * it waits in Needs linking, and `unlinkedBy` says who took it off — the
 * robot never links again a report a person took off; one it took off itself
 * it may put back on a shift it fits (never a job). Only while it's still on
 * that shift (`report.shiftId`, when given) with that round: if it changed
 * meanwhile, nothing changes and this throws AttachRefused (code FF_CHANGED).
 */
async function takeOffShift(
  report: { id: string; formSubmissionId: string | null; reviewId: string | null; shiftId?: string | null },
  note: string,
  opts: { by: FastFieldUnlinkBy },
): Promise<void> {
  const now = new Date();
  await prisma.$transaction(
    async (tx) => {
      const off = await tx.fastFieldReport.updateMany({
        where: {
          id: report.id,
          status: "LINKED",
          formSubmissionId: report.formSubmissionId,
          ...(report.shiftId !== undefined ? { shiftId: report.shiftId } : {}),
        },
        data: {
          status: "UNMATCHED",
          shiftId: null,
          formSubmissionId: null,
          linkedAt: null,
          unlinkedAt: now,
          unlinkedBy: opts.by,
          checkedAt: now,
          rulesVersion: FASTFIELD_RULES_VERSION,
          linkedByHand: false,
          note,
        },
      });
      if (off.count !== 1) throw new AttachRefused(CHANGED_MEANWHILE, "FF_CHANGED");
      await removeRound(tx, report.formSubmissionId);
    },
    { timeout: ATTACH_TX_MS },
  );
}

// ── Reports on a shift they don't fit ─────────────────────────────────────

type ShiftTimes = {
  id: string;
  officerId: string | null;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
};

const SHIFT_TIMES_SELECT = {
  id: true,
  officerId: true,
  scheduledStartsAt: true,
  scheduledEndsAt: true,
  actualStartedAt: true,
  actualEndedAt: true,
} as const;

export type ShiftReportCheck = {
  span: ReportSpan;
  /** The shift's window: earliest of the scheduled / actual start, latest of
   *  the ends. */
  shift: { start: Date; end: Date };
  /** Why the report doesn't fit the shift, or null when it does. */
  outside: string | null;
};

/** Whether a report on a shift fits inside it (it may have gone on before
 *  the rule, or the shift's times may have been changed since). */
export function checkReportOnShift(
  report: { submittedAt: Date; startedAt: Date | null; finishedAt: Date | null; answers: unknown },
  shift: ShiftTimes,
): ShiftReportCheck {
  const span = reportSpan(
    extractFacts({
      submittedAt: report.submittedAt,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      answers: report.answers as FastFieldAnswer[],
    }),
  );
  const window = toShiftCandidate(shift);
  const fit = shiftFit(span, window);
  return { span, shift: { start: window.start, end: window.end }, outside: fit.fits ? null : outsideShiftText(fit) };
}

export type OutsideShiftRow = ShiftReportCheck & {
  reportId: string;
  shiftId: string;
  siteName: string;
  outside: string;
};

/** How far back Admin → FastField looks for reports on a shift they don't fit. */
export const OUTSIDE_CHECK_DAYS = 14;

/**
 * Reports on a shift they don't fit inside — they start before it starts or
 * finish after it ends — filed in the last `sinceDays`, newest first. Each
 * report's own times come from its answers, so this reads them in Node.
 */
export async function reportsOutsideTheirShift(
  sinceDays = OUTSIDE_CHECK_DAYS,
  now: Date = new Date(),
): Promise<OutsideShiftRow[]> {
  const rows = await prisma.fastFieldReport.findMany({
    where: {
      status: "LINKED",
      shiftId: { not: null },
      // Put there by a person, on purpose.
      linkedByHand: false,
      submittedAt: { gte: new Date(now.getTime() - sinceDays * 86_400_000) },
    },
    orderBy: { submittedAt: "desc" },
    take: 2000,
    select: {
      id: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      answers: true,
      shift: { select: { ...SHIFT_TIMES_SELECT, site: { select: { name: true } } } },
    },
  });
  const out: OutsideShiftRow[] = [];
  for (const r of rows) {
    if (!r.shift) continue;
    const check = checkReportOnShift(r, r.shift);
    if (check.outside) {
      out.push({
        ...check,
        outside: check.outside,
        reportId: r.id,
        shiftId: r.shift.id,
        siteName: r.shift.site.name,
      });
    }
  }
  return out;
}

// ── The robot's shift check ───────────────────────────────────────────────

export type ShiftCheckSummary = {
  /** Reports on a shift looked at this time. */
  checked: number;
  /** …that fit their shift (stamped, not looked at again until the shift changes). */
  fit: number;
  /** …moved to another shift at the site that they do fit. */
  moved: number;
  /** …taken off their shift, waiting in Needs linking. */
  takenOff: number;
  /** …that don't fit but were sent to the client in a report, so stay. */
  kept: number;
  /** Reports the robot had taken off, put back on a shift they now fit. */
  putBack: number;
  /** Whether more were waiting to be checked when the time ran out. */
  more: boolean;
};

/** Reports checked per database round. */
const SHIFT_CHECK_BATCH = 300;

/**
 * The robot's shift check: every report on a shift must fit inside it — not
 * start before the shift starts or finish after it ends. It looks at each
 * report on a shift that it hasn't checked yet, or whose shift has changed
 * since (`shiftCheckedAt`), so its first pass covers every report ever put on
 * a shift, then only new links, edited shifts, and every report again after
 * the shift-fit rule changes (SHIFT_RULES_CHANGED_AT). Reports a person linked
 * by hand are left where they were put. A report that doesn't fit
 * moves to another shift at the site it does fit, else comes off its shift
 * and waits in Needs linking (`unlinkedAt`: the robot won't link it again,
 * and never makes or bills a job for it). Each change goes on the shift's
 * history. Runs from the 5-minute recheck until its time budget is spent.
 */
export async function checkShiftLinks(
  opts: { budgetMs?: number; now?: Date } = {},
): Promise<ShiftCheckSummary> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 15_000;
  const summary: ShiftCheckSummary = {
    checked: 0,
    fit: 0,
    moved: 0,
    takenOff: 0,
    kept: 0,
    putBack: 0,
    more: false,
  };
  const ctx = newCtx();
  const tried = new Set<string>();

  // First, reports the robot took off that may fit a shift now — up to half
  // the time, so the check itself always gets a turn.
  await putBackTakenOff(ctx, started + budget / 2, summary);

  while (Date.now() - started < budget) {
    const due = await prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "FastFieldReport" r
      JOIN "Shift" s ON s.id = r."shiftId"
      WHERE r.status = 'LINKED'
        AND r."linkedByHand" = false
        AND (r."shiftCheckedAt" IS NULL
          OR s."updatedAt" > r."shiftCheckedAt"
          OR r."shiftCheckedAt" < ${SHIFT_RULES_CHANGED_AT})
      ORDER BY r."submittedAt" DESC
      LIMIT ${SHIFT_CHECK_BATCH}`;
    const ids = due.map((d) => d.id).filter((id) => !tried.has(id));
    if (ids.length === 0) return summary;
    const rows = await prisma.fastFieldReport.findMany({
      where: { id: { in: ids }, status: "LINKED" },
      select: {
        id: true,
        submittedAt: true,
        startedAt: true,
        finishedAt: true,
        answers: true,
        formSubmissionId: true,
        shift: { select: { ...SHIFT_TIMES_SELECT, siteId: true } },
        formSubmission: {
          select: { review: { select: { id: true, _count: { select: { clientReports: true } } } } },
        },
      },
    });
    const fitting: string[] = [];
    for (const r of rows) {
      tried.add(r.id);
      if (!r.shift) continue;
      if (Date.now() - started >= budget) {
        summary.more = true;
        break;
      }
      summary.checked++;
      try {
        const outcome = await checkOneShiftLink(ctx, r, r.shift);
        if (outcome === "fit") fitting.push(r.id);
        else summary[outcome]++;
      } catch (e) {
        console.error("FastField shift check failed for one report:", errCode(e));
      }
    }
    if (fitting.length) {
      await prisma.fastFieldReport.updateMany({
        where: { id: { in: fitting } },
        data: { shiftCheckedAt: opts.now ?? new Date() },
      });
      summary.fit += fitting.length;
    }
    if (summary.more) return summary;
    if (due.length < SHIFT_CHECK_BATCH) return summary;
  }
  summary.more = true;
  return summary;
}

/** When the shift-fit rule last changed (24 Nov: the 30-minute allowance,
 *  then only times typed on the form): every report on a shift is checked
 *  again, and those the robot took off are tried again, under the new rule. */
export const SHIFT_RULES_CHANGED_AT = new Date("2026-11-24T09:25:00Z");

/**
 * Reports the robot took off a shift go back on one they now fit — after the
 * shift-fit rule changes (SHIFT_RULES_CHANGED_AT), or once a shift at their
 * site is added or changed since the robot last looked. Shifts only: never a
 * job, never a new job. Reports someone unlinked by hand stay off.
 */
async function putBackTakenOff(ctx: Ctx, until: number, summary: ShiftCheckSummary): Promise<void> {
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "FastFieldReport" r
    WHERE r.status = 'UNMATCHED'
      AND r."unlinkedAt" IS NOT NULL
      AND r."siteId" IS NOT NULL
      AND r.note LIKE '%by the robot:%'
      AND (r."checkedAt" IS NULL
        OR r."checkedAt" < ${SHIFT_RULES_CHANGED_AT}
        OR EXISTS (
          SELECT 1 FROM "Shift" s WHERE s."siteId" = r."siteId" AND s."updatedAt" > r."checkedAt"
        ))
    ORDER BY r."submittedAt" DESC
    LIMIT ${SHIFT_CHECK_BATCH}`;
  for (const { id } of due) {
    if (Date.now() >= until) {
      summary.more = true;
      return;
    }
    try {
      const r = await prisma.fastFieldReport.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          siteId: true,
          submittedAt: true,
          startedAt: true,
          finishedAt: true,
          answers: true,
        },
      });
      if (!r || r.status !== "UNMATCHED" || !r.siteId) continue;
      const facts = extractFacts({
        submittedAt: r.submittedAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        answers: r.answers as FastFieldAnswer[],
      });
      const span = reportSpan(facts);
      const ps = pickShift(span, await shiftsNear(r.siteId, span.from), await officerFor(ctx, facts));
      if (ps.pick) {
        const res = await linkReportToShift(r.id, ps.pick.id, {
          ctx,
          note: `Put back on the shift ${shiftHoursText(ps.pick)} by the robot: it fits with the ${SHIFT_GRACE_MIN}-minute allowance.`,
        });
        if (res.ok) {
          summary.putBack++;
          await logShiftChange(ps.pick.id, "fastfield_put_back", { fastfieldReportId: r.id });
          continue;
        }
      }
      // Still fits no shift: don't look again until a shift there changes.
      await prisma.fastFieldReport.update({ where: { id: r.id }, data: { checkedAt: new Date() } });
    } catch (e) {
      console.error("FastField put-back failed for one report:", errCode(e));
    }
  }
}

async function checkOneShiftLink(
  ctx: Ctx,
  r: {
    id: string;
    submittedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    answers: unknown;
    formSubmissionId: string | null;
    formSubmission: { review: { id: string; _count: { clientReports: number } } | null } | null;
  },
  shift: ShiftTimes & { siteId: string },
): Promise<"fit" | "moved" | "takenOff" | "kept"> {
  const facts = extractFacts({
    submittedAt: r.submittedAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    answers: r.answers as FastFieldAnswer[],
  });
  const span = reportSpan(facts);
  const current = toShiftCandidate(shift);
  if (shiftFit(span, current).fits) return "fit";

  const others = await shiftsNear(shift.siteId, span.from);
  const action = shiftLinkAction(span, current, others, await officerFor(ctx, facts));
  if (action.kind === "fit") return "fit";
  const now = new Date();
  const why = `the report (${spanText(span)}) ${outsideShiftText(action.why)}`;

  if (action.kind === "move") {
    const to = action.to;
    await prisma.$transaction(async (tx) => {
      await tx.fastFieldReport.update({
        where: { id: r.id },
        data: {
          shiftId: to.id,
          shiftCheckedAt: now,
          note: `Moved by the robot from the shift ${shiftHoursText(current)} to the shift ${shiftHoursText(to)}, which it fits inside: ${why}.`,
        },
      });
      if (r.formSubmissionId) {
        await tx.formSubmission.update({ where: { id: r.formSubmissionId }, data: { shiftId: to.id } });
      }
    });
    await logShiftChange(shift.id, "fastfield_moved_off", { fastfieldReportId: r.id, toShiftId: to.id });
    await logShiftChange(to.id, "fastfield_moved_on", { fastfieldReportId: r.id, fromShiftId: shift.id });
    return "moved";
  }

  const review = r.formSubmission?.review ?? null;
  if (review && review._count.clientReports > 0) {
    // Gone to the client in a report: leave it, but don't look again until
    // the shift changes.
    await prisma.fastFieldReport.update({ where: { id: r.id }, data: { shiftCheckedAt: now } });
    return "kept";
  }
  await takeOffShift(
    { id: r.id, formSubmissionId: r.formSubmissionId, reviewId: review?.id ?? null, shiftId: shift.id },
    `Taken off the shift ${shiftHoursText(current)} by the robot: ${why} — more than the ${SHIFT_GRACE_MIN} minutes allowed — and it doesn't fit any other shift there. Link it to the right activity or set it aside.`,
    { by: "ROBOT" },
  );
  await logShiftChange(shift.id, "fastfield_unlinked", { fastfieldReportId: r.id, by: "robot" });
  return "takenOff";
}

/** A line on the shift's history (Shift → History), written by the robot. */
async function logShiftChange(shiftId: string, action: string, diff: Prisma.InputJsonValue): Promise<void> {
  await prisma.activityLog
    .create({ data: { entity: "Shift", entityId: shiftId, action, diff } })
    .catch((e) => console.error("FastField shift check: history line not written:", errCode(e)));
}

// ── Skipped places ────────────────────────────────────────────────────────

const skipNote = (label: string) => `Set aside: "${label}" is a skipped place.`;

/**
 * Skip a place: set aside every waiting report whose site, as typed, is the
 * same place (siteKey) — and new ones as they arrive, unless they match an
 * activity. Skipping a place that's already skipped sets aside any report
 * typed like it that's waiting again.
 */
export async function skipPlace(
  key: string,
  by: string,
): Promise<{ ok: true; label: string; setAside: number } | { ok: false; error: string }> {
  if (!key || siteKey(key) !== key) return { ok: false, error: "That place doesn't look right." };
  const waiting = (
    await prisma.fastFieldReport.findMany({
      where: { status: "UNMATCHED", siteText: { not: null } },
      select: { id: true, siteText: true, submittedAt: true },
    })
  ).filter((r) => siteKey(r.siteText) === key);
  const label =
    groupByPlace(waiting.map((r) => ({ siteText: r.siteText, submittedAt: r.submittedAt, siteName: null })))[0]
      ?.label ?? key;
  const skip = await prisma.fastFieldSkip.upsert({
    where: { siteKey: key },
    create: { siteKey: key, label: label.slice(0, 200), createdBy: by },
    update: {},
    select: { id: true, label: true },
  });
  if (waiting.length === 0) return { ok: true, label: skip.label, setAside: 0 };
  const res = await prisma.fastFieldReport.updateMany({
    where: { id: { in: waiting.map((r) => r.id) }, status: "UNMATCHED" },
    data: { status: "IGNORED", skipId: skip.id, note: skipNote(skip.label) },
  });
  return { ok: true, label: skip.label, setAside: res.count };
}

/** Stop skipping a place: the reports it set aside wait again (the robot tries
 *  them again), and new ones typed like it wait as usual. */
export async function stopSkipping(
  skipId: string,
  by: string,
): Promise<{ ok: true; label: string; broughtBack: number } | { ok: false; error: string }> {
  const skip = await prisma.fastFieldSkip.findUnique({ where: { id: skipId }, select: { id: true, label: true } });
  if (!skip) return { ok: false, error: "That place isn't skipped any more." };
  const [res] = await prisma.$transaction([
    prisma.fastFieldReport.updateMany({
      where: { skipId: skip.id, status: "IGNORED" },
      data: {
        status: "UNMATCHED",
        skipId: null,
        checkedAt: null,
        note: `Brought back by ${by}. The robot tries it again.`,
      },
    }),
    prisma.fastFieldSkip.delete({ where: { id: skip.id } }),
  ]);
  return { ok: true, label: skip.label, broughtBack: res.count };
}

export type NearbyActivity = {
  kind: "job" | "visit" | "shift";
  id: string;
  /** JobType, "PATROL" for a visit, "SHIFT" for a shift. */
  type: string;
  at: Date;
  /** Shifts: when it ends. */
  until?: Date;
  /** 0 for a shift the report fits inside. */
  minutesApart: number;
  taken: boolean;
  /** Shifts only: why the report can't go on it ("started 25 min before the
   *  shift"), or null when it fits inside. */
  outside?: string | null;
};

/** Activities at a site for linking a report by hand: anything there from a
 *  day before the report's time to a day after (MANUAL_LINK_WINDOW_MIN; the
 *  robot only looks within 3 hours, or 18). The shifts the report fits inside
 *  come first, then the rest, nearest first. A shift it doesn't fit is listed
 *  with the reason, and can't be linked. */
export async function activitiesNearReport(
  reportId: string,
  siteId: string,
): Promise<NearbyActivity[]> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: REPORT_SELECT,
  });
  if (!report) return [];
  const facts = factsOf(report);
  const t = facts.when.getTime();
  const span = reportSpan(facts);
  const [candidates, shifts] = await Promise.all([
    candidatesNear(siteId, facts.when, MANUAL_LINK_WINDOW_MIN),
    shiftsForLinking(siteId, facts.when),
  ]);
  const shiftRows: NearbyActivity[] = shifts.map((s) => {
    const fit = shiftFit(span, s);
    return {
      kind: "shift",
      id: s.id,
      type: "SHIFT",
      at: s.start,
      until: s.end,
      minutesApart: shiftApartMin(span, s),
      taken: false,
      outside: fit.fits ? null : outsideShiftText(fit),
    };
  });
  const jobRows: NearbyActivity[] = candidates.map((c) => {
    const at = c.times.reduce((best, x) =>
      Math.abs(x.getTime() - t) < Math.abs(best.getTime() - t) ? x : best,
    );
    return {
      kind: c.kind,
      id: c.id,
      type: c.type,
      at,
      minutesApart: Math.round(Math.abs(at.getTime() - t) / 60000),
      taken: c.taken,
    };
  });
  const fitting = shiftRows.filter((r) => !r.outside);
  const rest = [...shiftRows.filter((r) => r.outside), ...jobRows].sort(
    (a, b) => a.minutesApart - b.minutesApart,
  );
  return [...fitting, ...rest];
}
