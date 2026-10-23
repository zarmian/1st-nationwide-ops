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
 *   - the static / dog-handler shift on at the time, for patrol forms — a
 *     shift takes any number of reports, one per patrol round;
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
import { Prisma, type FastFieldFormMode, type JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime, formatTime } from "@/lib/dates";
import { haversineMeters } from "@/lib/geo";
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
  apartText,
  extractFacts,
  MATCH_WINDOW_MIN,
  WIDE_MATCH_WINDOW_MIN,
  pickActivity,
  pickActivityWide,
  pickOfficer,
  pickShift,
  pickSite,
  pickSiteByActivity,
  SHIFT_AROUND_EARLY_MIN,
  SHIFT_AROUND_LATE_MIN,
  shiftAround,
  shiftsOn,
  type ActivityCandidate,
  type CustomerRow,
  type FastFieldAnswer,
  type FastFieldFacts,
  type FastFieldIncoming,
  type PersonRow,
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
};

function newCtx(): Ctx {
  return { sites: new Map(), customers: null, people: null, claimed: new Set(), virtual: [] };
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

/** Static / dog-handler shifts at the sites that started up to a day (plus
 *  the late margin) before the report — shifts can be long — or up to the
 *  early margin after it, with their full window. */
async function shiftsNearSites(siteIds: string[], when: Date) {
  const range = {
    gte: new Date(when.getTime() - (24 * 60 + SHIFT_AROUND_LATE_MIN) * 60000),
    lte: new Date(when.getTime() + SHIFT_AROUND_EARLY_MIN * 60000),
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

async function shiftsNear(siteId: string, when: Date): Promise<ShiftCandidate[]> {
  return (await shiftsNearSites([siteId], when)).map(toShiftCandidate);
}

/**
 * Which of these sites had work on at the report's time: a static shift on,
 * or a job or visit within 3 hours. Used when the form's site fits several
 * sites, or none but the phone was near some.
 */
async function sitesWithWorkOn(siteIds: string[], when: Date): Promise<Set<string>> {
  if (siteIds.length === 0) return new Set();
  const range = {
    gte: new Date(when.getTime() - MATCH_WINDOW_MIN * 60000),
    lte: new Date(when.getTime() + MATCH_WINDOW_MIN * 60000),
  };
  const [shifts, jobs, visits] = await Promise.all([
    shiftsNearSites(siteIds, when),
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
    if (shiftsOn(when, [toShiftCandidate(sh)]).length) out.add(sh.siteId);
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
    );
    const byWork = pickSiteByActivity(facts, sp.candidates, active);
    if (!byWork) return { action: "unmatched", site: null, reason: "site", note: sp.reason };
    site = byWork;
    how = siteHow("activity", null);
  }
  const kind = (facts.visitType as JobType | null) ?? form.jobType;
  const at = formatDateTime(facts.when);
  const shifts = await shiftsNear(site.id, facts.when);
  const shiftsNow = shiftsOn(facts.when, shifts);
  const officerId = await officerFor(ctx, facts);

  const toShift = (sh: ShiftCandidate, note: string): Decision => ({
    action: "link",
    site,
    target: { kind: "shift", id: sh.id, type: "SHIFT" },
    note: note + how,
  });
  const span = (sh: ShiftCandidate) => `${formatTime(sh.start)}–${formatTime(sh.end)}`;
  const sharedNote = " Two shifts were on; it went to the one that started first.";

  // A patrol round during a static shift belongs to that shift.
  if (kind === "PATROL" && shiftsNow.length) {
    const ps = pickShift(facts.when, shiftsNow, officerId);
    if (ps.pick) {
      return toShift(
        ps.pick,
        `Filed during the static shift at ${site.name} (${span(ps.pick)}).${ps.shared ? sharedNote : ""}`,
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
    const ps = pickShift(facts.when, shiftsNow, officerId);
    if (ps.pick) {
      return toShift(
        ps.pick,
        `Filed during the static shift at ${site.name} (${span(ps.pick)}), with no other activity to attach it to.${ps.shared ? sharedNote : ""}`,
      );
    }
  }
  // A patrol round sent in a little before or after a shift.
  if (kind === "PATROL") {
    const sa = shiftAround(facts.when, shifts);
    if (sa) {
      return toShift(
        sa.pick,
        `Filed ${apartText(sa.gapMin)} ${sa.after ? "after the static shift ended" : "before the static shift started"} at ${site.name} (${span(sa.pick)}), so it went to that shift.`,
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

function addCounts(into: Counts, from: Counts): Counts {
  into.linked += from.linked;
  into.created += from.created;
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
      if (preview) {
        tally(summary, decision, form.formId);
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
 *   2. any site added or changed since then (it may be the report's real site);
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
  return dueForRecheck(waiting, changes, site?.updatedAt ?? null, now, all);
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
      form: { select: FORM_SELECT },
    },
  });
  if (!row || row.status !== "UNMATCHED" || row.form.mode !== "ON") return false;
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
    prisma.fastFieldReport.count({ where: { ...filed, status: "LINKED", note: { startsWith: "Linked by " } } }),
    prisma.fastFieldReport.count({ where: { ...filed, status: "CREATED", note: { contains: " created by " } } }),
    prisma.fastFieldReport.findMany({
      where: { ...filed, status: "UNMATCHED" },
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
        shiftsNear(d.site.id, facts.when),
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

/** Attach a patrol report to the static / dog-handler shift it was filed
 *  during. The shift itself is left as it is — its own check-ins, times and
 *  pay stand; the report is extra evidence (and its photos appear in the
 *  client's static-guarding report). */
export async function linkReportToShift(
  reportId: string,
  shiftId: string,
  opts: { note?: string; ctx?: Ctx } = {},
): Promise<ActionResult> {
  const report = await loadOpenReport(reportId);
  if ("error" in report) return { ok: false, error: report.error };
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, siteId: true },
  });
  if (!shift) return { ok: false, error: "Shift not found." };

  const facts = factsOf(report);
  const officerId = await officerFor(opts.ctx ?? newCtx(), facts);
  await prisma.$transaction(async (tx) => {
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
        status: "LINKED",
        shiftId: shift.id,
        siteId: shift.siteId,
        formSubmissionId: submissionId,
        ...(opts.note ? { note: opts.note } : {}),
      },
    });
  });
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

  const facts = factsOf(report);
  const type = opts.type ?? (facts.visitType as JobType | null) ?? report.form.jobType;
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

export type NearbyActivity = {
  kind: "job" | "visit" | "shift";
  id: string;
  /** JobType, "PATROL" for a visit, "SHIFT" for a shift. */
  type: string;
  at: Date;
  /** Shifts: when it ends. */
  until?: Date;
  /** 0 for a shift that was on at the time. */
  minutesApart: number;
  taken: boolean;
};

/** Activities near a report's time at a site, for linking by hand: the shifts
 *  on at the time, then jobs and visits within 3 hours — or, when there are
 *  none, within 18 hours — nearest first. */
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
  const [near, shifts] = await Promise.all([
    candidatesNear(siteId, facts.when),
    shiftsNear(siteId, facts.when),
  ]);
  const candidates = near.length
    ? near
    : await candidatesNear(siteId, facts.when, WIDE_MATCH_WINDOW_MIN);
  const shiftRows: NearbyActivity[] = shiftsOn(facts.when, shifts).map((s) => ({
    kind: "shift",
    id: s.id,
    type: "SHIFT",
    at: s.start,
    until: s.end,
    minutesApart: 0,
    taken: false,
  }));
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
  return [...shiftRows, ...jobRows.sort((a, b) => a.minutesApart - b.minutesApart)];
}
