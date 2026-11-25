/**
 * FastField import — attaches FastField reports to the activities they're
 * about. The robot (scripts/fastfield-forms.mjs) lists submissions, asks
 * planFastField() which ones are new, then sends each new one (answers,
 * photos already copied to our storage) to importFastField().
 *
 * Forms are shared between clients (the Site Patrol and Alarm Response forms
 * are used for Shurgard and others), so the site in the report decides the
 * client: a postcode typed in the site name, else the name, else GPS
 * (lib/fastfield.ts). Where it goes is judged only by the times typed in it
 * — never the phone's opened / finished times, never the send time: a report
 * with no usable typed time waits for a person. The report then goes to:
 *   - a static / dog-handler shift it fits — starting no more than 30
 *     minutes before the shift and finishing no more than 30 minutes after
 *     it (shiftFit) — a patrol round first, any report with nothing else to
 *     attach it to; a shift takes any number of reports, one per round;
 *   - otherwise the nearest job or patrol visit there within 3 hours (or the
 *     same kind of work within 18) — unless that one already has a report:
 *     then the report waits for a person.
 * It is attached the way an officer's own report is: a FormSubmission with an
 * approved review, and (for a job or visit) the activity marked done with the
 * officer's times, billed and paid. FastField reports were already sent to
 * the client from FastField, so they skip the review queue, client emails and
 * SMS acks.
 *
 * When nothing matches, the job is created only at the client the form names
 * for that (Shurgard); everything else waits on /admin/fastfield to be linked
 * by hand (linkReportToJob / linkReportToVisit / linkReportToShift /
 * createJobForReport), where a person can link any report to any activity.
 * Every 5 minutes the robot also checks its own shift links
 * (checkShiftLinks) and tries waiting reports again (retryUnmatched).
 */
import { Prisma, type FastFieldFormMode, type FastFieldUnlinkBy, type JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FASTFIELD_RULES_VERSION } from "@/lib/fastfieldRulesVersion";
import { sentToClient } from "@/lib/fastfieldSentToClient";
import { withRunLock } from "@/lib/runLock";
import { formatDateTime, formatTime } from "@/lib/dates";
import { haversineMeters } from "@/lib/geo";
import { fillJobFinance, fillVisitFinance, type FinanceFilled } from "@/lib/billing";
import { logActivity } from "@/lib/audit";
import { broughtBackNote, createdByHand, placesFromCounts, TIME_ANSWER_TYPES } from "@/lib/fastfieldAdminList";
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
  withTimesNote,
  MANUAL_LINK_WINDOW_MIN,
  MATCH_WINDOW_MIN,
  WIDE_MATCH_WINDOW_MIN,
  matchOfficer,
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
  // Active staff first. A name several of them fit names nobody: it isn't
  // passed on to staff who have left, who'd then be guessed.
  const m = matchOfficer(facts, ctx.people.active);
  if (m.kind !== "none") return m.kind === "one" ? m.person.id : null;
  return pickOfficer(facts, ctx.people.inactive);
}

/** A moment as the database stores DateTimes (UTC, no zone), for raw SQL.
 *  Prisma sends a Date as `timestamptz`; compared straight with a
 *  `timestamp(3)` column that is only right while the session's time zone is
 *  UTC, so convert it explicitly. */
const asStored = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/** At most this many jobs, and this many visits, per site and window. */
const CANDIDATE_CAP = 50;

/** Jobs and patrol visits at a site within the matching window (3 hours, or
 *  `windowMin`) either side of the report: the nearest CANDIDATE_CAP of each,
 *  measured from each one's nearest time (a job's creation only when it has
 *  no other time), so the cap never drops a closer one for a farther one. */
async function candidatesNear(
  siteId: string,
  when: Date,
  windowMin: number = MATCH_WINDOW_MIN,
): Promise<ActivityCandidate[]> {
  const at = asStored(when);
  const lo = asStored(new Date(when.getTime() - windowMin * 60000));
  const hi = asStored(new Date(when.getTime() + windowMin * 60000));
  const away = (col: Prisma.Sql) => Prisma.sql`ABS(EXTRACT(EPOCH FROM (${col} - ${at})))`;
  const job = (c: string) => Prisma.raw(`j."${c}"`);
  const visit = (c: string) => Prisma.raw(`v."${c}"`);
  const [jobs, visits] = await Promise.all([
    prisma.$queryRaw<
      {
        id: string;
        type: string;
        scheduledFor: Date | null;
        startedAt: Date | null;
        completedAt: Date | null;
        createdAt: Date;
        taken: boolean;
      }[]
    >`
      SELECT j.id, j.type::text AS type, j."scheduledFor", j."startedAt", j."completedAt", j."createdAt",
             EXISTS (SELECT 1 FROM "FastFieldReport" f WHERE f."jobId" = j.id) AS taken
      FROM "Job" j
      WHERE j."siteId" = ${siteId}::uuid
        AND j.status <> 'CANCELLED'
        AND j."handledByPartnerId" IS NULL
        AND j."patrolVisitId" IS NULL -- the visit itself is the candidate
        AND j.type::text NOT IN (${Prisma.join(NOT_MATCHABLE)})
        AND (j."scheduledFor" BETWEEN ${lo} AND ${hi}
          OR j."startedAt" BETWEEN ${lo} AND ${hi}
          OR j."completedAt" BETWEEN ${lo} AND ${hi}
          OR (j."scheduledFor" IS NULL AND j."startedAt" IS NULL AND j."completedAt" IS NULL
              AND j."createdAt" BETWEEN ${lo} AND ${hi}))
      ORDER BY COALESCE(
          LEAST(${away(job("scheduledFor"))}, ${away(job("startedAt"))}, ${away(job("completedAt"))}),
          ${away(job("createdAt"))}),
        j.id
      LIMIT ${CANDIDATE_CAP}`,
    prisma.$queryRaw<
      {
        id: string;
        scheduledAt: Date;
        arrivedAt: Date | null;
        departedAt: Date | null;
        taken: boolean;
      }[]
    >`
      SELECT v.id, v."scheduledAt", v."arrivedAt", v."departedAt",
             EXISTS (SELECT 1 FROM "FastFieldReport" f WHERE f."patrolVisitId" = v.id) AS taken
      FROM "PatrolVisit" v
      WHERE v."siteId" = ${siteId}::uuid
        AND v.status <> 'CANCELLED'
        AND v."handledByPartnerId" IS NULL
        AND (v."scheduledAt" BETWEEN ${lo} AND ${hi} OR v."arrivedAt" BETWEEN ${lo} AND ${hi})
      ORDER BY LEAST(${away(visit("scheduledAt"))}, ${away(visit("arrivedAt"))}, ${away(visit("departedAt"))}),
        v.id
      LIMIT ${CANDIDATE_CAP}`,
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
        taken: j.taken,
      };
    }),
    ...visits.map((v) => ({
      kind: "visit" as const,
      id: v.id,
      type: "PATROL",
      times: present([v.scheduledAt, v.arrivedAt, v.departedAt]),
      taken: v.taken,
    })),
  ];
}

/** How far back a shift a report fits can have started. */
const SHIFT_REACH_MS = 36 * 3_600_000;

/** Static / dog-handler shifts at the sites that a report starting at `from`
 *  could fit: those that started (scheduled or actual) up to 36 hours before
 *  it — shifts can be long — or within the allowance after it, with their
 *  full window. The 50 that started latest — the nearest — if there are more.
 *
 *  Never a partner's shift: their officers report in their own app, as with
 *  partners' jobs and visits, so a round of ours that fits only a partner's
 *  shift belongs to our own work there (a visit, a callout).
 *
 *  Missed / abandoned shifts are deliberately kept: a shift is marked missed
 *  when nobody started it on the duty link, though an officer may still have
 *  worked it — the rounds are the evidence — and if such a shift were left
 *  out, a round that fits it would see "no shift on" and could complete a
 *  nearby visit or, on a make-the-job form, create and bill a callout
 *  instead. A shift link bills nothing. */
async function shiftsNearSites(siteIds: string[], from: Date) {
  const range = {
    gte: new Date(from.getTime() - SHIFT_REACH_MS),
    lte: new Date(from.getTime() + SHIFT_GRACE_MIN * 60000),
  };
  return prisma.shift.findMany({
    where: {
      siteId: { in: siteIds },
      handledByPartnerId: null,
      OR: [{ scheduledStartsAt: range }, { actualStartedAt: range }],
    },
    select: {
      id: true,
      siteId: true,
      officerId: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      actualStartedAt: true,
      actualEndedAt: true,
    },
    orderBy: [{ scheduledStartsAt: "desc" }, { id: "asc" }],
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
    scheduled: { start: s.scheduledStartsAt, end: s.scheduledEndsAt },
  };
}

async function shiftsNear(siteId: string, from: Date): Promise<ShiftCandidate[]> {
  return (await shiftsNearSites([siteId], from)).map(toShiftCandidate);
}

/** Most shifts, jobs and visits (each) listed for linking a report by hand. */
const HAND_LINK_TAKE = 200;

/**
 * Shifts at a site whose window — the earliest of the scheduled / actual
 * start to the latest of the ends — overlaps [from, to], earliest first. The
 * hand-link list passes its own [from, to] (days either side of the report,
 * or one day); by default it's MANUAL_LINK_WINDOW_MIN either side of `when`
 * (the connector's review of waiting reports). Any shift there counts — a
 * partner's, a missed or an abandoned one too: a person may link a report to
 * any shift. The robot's own search is `shiftsNearSites`.
 */
async function shiftsForLinking(
  siteId: string,
  when: Date,
  window?: { from: Date; to: Date },
  take: number = HAND_LINK_TAKE,
): Promise<(ShiftCandidate & { type: string; status: string; partner: boolean })[]> {
  const reach = MANUAL_LINK_WINDOW_MIN * 60000;
  const from = window?.from ?? new Date(when.getTime() - reach);
  const to = window?.to ?? new Date(when.getTime() + reach);
  const rows = await prisma.shift.findMany({
    where: {
      siteId,
      AND: [
        { OR: [{ scheduledStartsAt: { lte: to } }, { actualStartedAt: { lte: to } }] },
        { OR: [{ scheduledEndsAt: { gte: from } }, { actualEndedAt: { gte: from } }] },
      ],
    },
    orderBy: [{ scheduledStartsAt: "asc" }, { id: "asc" }],
    take,
    select: {
      id: true,
      officerId: true,
      type: true,
      status: true,
      handledByPartnerId: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      actualStartedAt: true,
      actualEndedAt: true,
    },
  });
  return rows.map((s) => ({
    ...toShiftCandidate(s),
    type: s.type,
    status: s.status,
    partner: s.handledByPartnerId != null,
  }));
}

/**
 * Which of these sites had work on at the report's time: a static shift the
 * report fits (with the allowance), or a job or visit within 3 hours. Used
 * when the form's site fits several sites, or none but the phone was near
 * some.
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

export type UnmatchedReason = "site" | "none" | "taken" | "ambiguous" | "shift" | "time";

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
  // The report's time: only times typed on the form — never the phone's
  // opened / finished times, never the send time.
  const span = reportSpan(facts);
  const when = facts.when;
  let site: SiteRow;
  let how: string;
  if (sp.site) {
    site = sp.site;
    how = siteHow(sp.how, sp.distanceM);
  } else {
    // The form's site fits several sites, or none but the phone was near
    // some: the one that had work on at the time — which needs a typed time.
    if (!span || !when) {
      return { action: "unmatched", site: null, reason: "site", note: withTimesNote(sp.reason, facts) };
    }
    const active = await sitesWithWorkOn(
      sp.candidates.map((c) => c.id),
      when,
      span,
    );
    const byWork = pickSiteByActivity(facts, sp.candidates, active);
    if (!byWork) return { action: "unmatched", site: null, reason: "site", note: withTimesNote(sp.reason, facts) };
    site = byWork;
    how = siteHow("activity", null);
  }
  how = withTimesNote(how, facts); // typed times it couldn't use: every note says so
  // With no usable typed time, nothing says when the round was done, so the
  // robot can't tell which shift or job it belongs to: a person links it.
  if (!span || !when) {
    return {
      action: "unmatched",
      site,
      reason: "time",
      note:
        (facts.timesNote
          ? `The times typed on the form can't be right, so the robot can't tell which shift or job at ${site.name} it belongs to — link it by hand.`
          : `No time was typed on the form, so the robot can't tell which shift or job at ${site.name} it belongs to — link it by hand.`) + how,
    };
  }
  const kind = (facts.visitType as JobType | null) ?? form.jobType;
  const at = formatDateTime(when);
  // The robot only puts a report on a shift it fits: it starts no more than
  // SHIFT_GRACE_MIN before the shift starts and finishes no more than that
  // after it ends (shiftFit).
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

  let candidates = await candidatesNear(site.id, when);
  if (preview) {
    candidates = candidates.map((c) => (ctx.claimed.has(c.id) ? { ...c, taken: true } : c));
    for (const v of ctx.virtual) {
      if (v.siteId === site.id) {
        candidates.push({ kind: "job", id: `virtual-${candidates.length}`, type: v.type, times: [v.when], taken: true });
      }
    }
  }

  let ap = pickActivity(when, kind, candidates);
  // Nothing within 3 hours and no static shift on: a report filed late, or a
  // job logged at the wrong time — look for the same kind of work up to 18
  // hours either side (whose best match may already have a report).
  let wide = false;
  if (!ap.pick && ap.reason === "none" && !shiftsNow.length) {
    let far = await candidatesNear(site.id, when, WIDE_MATCH_WINDOW_MIN);
    if (preview) far = far.map((c) => (ctx.claimed.has(c.id) ? { ...c, taken: true } : c));
    const wp = pickActivityWide(when, kind, far, new Date());
    if (wp.pick || wp.reason === "taken") {
      ap = wp;
      wide = true;
    }
  }
  if (ap.pick) {
    const nearest = ap.pick.times.reduce((best, t) =>
      Math.abs(t.getTime() - when.getTime()) < Math.abs(best.getTime() - when.getTime()) ? t : best,
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
  // billed twice). Not when the best match already has a report: then it's
  // most likely a second report for that, and it waits for a person (below).
  if (shiftsNow.length && ap.reason !== "taken") {
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
      : `It looks like the ${noun(ap.taken.type)} at ${wide ? formatDateTime(ap.at) : formatTime(ap.at)} at ${site.name}, which already has a report — link it by hand if it's a second report for it.`;
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
    unmatched: { site: 0, none: 0, taken: 0, ambiguous: 0, shift: 0, time: 0 },
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
  // FastField's own timestamps (sent, form opened / finished), not typed
  // answers. Whether they carry a zone is unverified (a discovery run would
  // show); one without a zone is read as the server does, i.e. as UTC.
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

  // Oldest first, so an earlier report claims an activity before a later one
  // (by its typed time; one with none can't claim anything, so it's simply
  // taken in the order received).
  const work = reports
    .map((r) => {
      const t = incomingTimes(r);
      return { r, t, facts: extractFacts({ submittedAt: t.submittedAt, answers: r.answers }) };
    })
    .sort(
      (a, b) =>
        (a.facts.when ?? a.facts.submittedAt).getTime() - (b.facts.when ?? b.facts.submittedAt).getTime(),
    );

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

    // Set once the report is stored, so a failure after that can say so on it.
    let storedId: string | null = null;
    const judgedAt = new Date();
    try {
      const decision = await decide(ctx, facts, form, preview);
      const skip = await skipFor(ctx, decision, facts.siteText);
      if (preview) {
        if (skip) tallySkipped(summary, form.formId);
        else tally(summary, decision, form.formId);
        if (decision.action === "link" && decision.target.kind !== "shift") {
          ctx.claimed.add(decision.target.id);
        }
        if (decision.action === "create" && facts.when) {
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
            // Judged under the current rules. One still to be attached is
            // stamped by the attach (or by its failure below), so a run cut
            // off in between leaves it due for the next retry.
            ...(skip || decision.action === "unmatched"
              ? { rulesVersion: FASTFIELD_RULES_VERSION }
              : {}),
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
      storedId = row.id;

      if (skip) {
        tallySkipped(summary, form.formId);
        continue;
      }
      await applyAndTally(ctx, row.id, decision, form.formId, summary, judgedAt);
    } catch (e) {
      console.error("FastField import failed for one report:", errCode(e));
      summary.failed++;
      // Stored, but attaching it threw: its note still says what it was
      // being matched to, which didn't happen.
      if (storedId) await noteFailedAttempt(storedId, judgedAt, FAILED_ATTACH_NOTE);
    }
  }
  if (preview && run) await recordPreview(run, summary.byForm);
  return summary;
}

/** Carry out a decision on a stored report. If attaching fails (the activity
 *  changed meanwhile), a report still waiting says why; `at` is when the
 *  decision's data was read. */
async function applyAndTally(
  ctx: Ctx,
  reportId: string,
  decision: Decision,
  formId: number,
  summary: ImportSummary,
  at: Date,
) {
  const applied = await applyDecision(ctx, reportId, decision);
  if (applied.ok) {
    tally(summary, decision, formId);
    return;
  }
  summary.failed++;
  await noteFailedAttempt(reportId, at, `Couldn't attach automatically: ${applied.error}`);
}

const FAILED_ATTACH_NOTE =
  "Couldn't attach automatically: something went wrong while attaching it. The robot tries it again later.";

/**
 * A run's attempt at a waiting report failed. Stamp the try (when its data
 * was read, under the current rules) so the report doesn't stay first in line
 * every run, holding the rest back; with `note`, say why on it. Only while
 * it's still waiting as it was: a report attached, set aside or taken off
 * meanwhile keeps what it says.
 */
async function noteFailedAttempt(reportId: string, at: Date, note?: string): Promise<void> {
  await prisma.fastFieldReport
    .updateMany({
      where: { id: reportId, status: "UNMATCHED", unlinkedAt: null },
      data: { checkedAt: at, rulesVersion: FASTFIELD_RULES_VERSION, ...(note ? { note } : {}) },
    })
    .catch((e) => console.error("FastField: a failed try wasn't recorded:", errCode(e)));
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
/** Every waiting report is looked at again at least this often — the sites
 *  may have changed even when its own site's work hasn't. */
export const RECHECK_EVERY_MS = 24 * 3_600_000;

export type WaitingReport = {
  id: string;
  siteId: string | null;
  /** When the work happened, roughly: opened on the phone, else filed. Only
   *  says which work changes are near it. */
  at: Date;
  submittedAt: Date;
  /** When the robot last tried it (its import, if not since). */
  lastLook: Date;
  /** The rules version it was last judged under (FASTFIELD_RULES_VERSION). */
  rulesVersion: number;
};

/** A job, visit or shift added or changed: where, when it changed, and the
 *  stretch of time it covers. */
export type WorkChange = { siteId: string; changedAt: Date; from: Date; to: Date };

/**
 * Which waiting reports are worth trying again, best first:
 *   1. work at the report's site added or changed, near its time, since it
 *      was last tried — newest report first (a shift logged the morning after);
 *   2. any site added or changed since then (it may be the report's real
 *      site), or last judged under older rules (a lower rules version) —
 *      newest first;
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
    else if (
      (latestSiteChange && latestSiteChange.getTime() > seen) ||
      r.rulesVersion < FASTFIELD_RULES_VERSION
    ) {
      sites.push(r);
    } else if (now.getTime() - seen >= RECHECK_EVERY_MS) stale.push(r);
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
      // Taken off its activity — by a person (left for a person) or by the
      // robot (only ever put back on a shift it fits: putBackTakenOff).
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
      rulesVersion: true,
    },
  });
  if (rows.length === 0) return [];
  const waiting: WaitingReport[] = rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    // Only the order it's retried in (never the phone's opened time).
    at: r.submittedAt,
    submittedAt: r.submittedAt,
    lastLook: r.checkedAt ?? r.createdAt,
    rulesVersion: r.rulesVersion,
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
    // Visits have no updatedAt: only new ones count as a change.
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
 *  not and when it was tried. False when it no longer needs trying. `at` is
 *  taken before anything is read, so a change made while it's being judged
 *  is newer than its stamp and brings it up again. */
async function recheckOne(
  ctx: Ctx,
  id: string,
  summary: ImportSummary,
  at: Date = new Date(),
): Promise<boolean> {
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
  // Taken off its activity: never matched again here. One a person took off
  // waits for a person; one the robot took off is only ever put back on a
  // shift it fits (putBackTakenOff).
  if (row.unlinkedAt) return false;
  const facts = extractFacts({
    submittedAt: row.submittedAt,
    answers: row.answers as unknown as FastFieldAnswer[],
  });
  const decision = await decide(ctx, facts, row.form, false);
  if (decision.action === "unmatched") {
    // Only while it still waits as it was read: a report a person attached
    // or set aside meanwhile keeps what it says.
    await prisma.fastFieldReport.updateMany({
      where: { id: row.id, status: "UNMATCHED", unlinkedAt: null },
      data: {
        siteId: decision.site?.id ?? null,
        note: decision.note,
        checkedAt: at,
        rulesVersion: FASTFIELD_RULES_VERSION,
      },
    });
    tally(summary, decision, row.form.formId);
    return true;
  }
  await applyAndTally(ctx, row.id, decision, row.form.formId, summary, at);
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

/** Only one copy of the matcher works at a time: the retry of waiting
 *  reports and the shift check (with its put-back) share this lock, whoever
 *  starts them — the 5-minute cron, the sync robot's retry, or the admin's
 *  "Try matching again". */
const MATCHER_LOCK = "fastfield-matcher";
/** A run's lease on the lock outlasts its time budget by this much: enough
 *  for the report it is on when the budget runs out (and the function's own
 *  time limit), short enough that a crashed run soon lets the next one in. */
const LOCK_MARGIN_MS = 60_000;

/**
 * Try waiting reports again — work may have been recorded since (a shift
 * logged the next morning), or a site added or fixed. Without ids it takes
 * the reports most likely to match now first (`dueForRecheck`), one at a
 * time, until the time budget is spent; each report tried is stamped (one
 * that fails too), so the next run carries on from there rather than
 * retrying the same ones. When another copy of the matcher is running, it
 * does nothing and says `busy`.
 */
export async function retryUnmatched(
  opts: { ids?: string[]; sinceDays?: number; all?: boolean; budgetMs?: number } = {},
): Promise<RetrySummary> {
  const budget = opts.budgetMs ?? 40_000;
  const held = await withRunLock(MATCHER_LOCK, budget + LOCK_MARGIN_MS, () =>
    retryUnmatchedNow(opts, budget),
  );
  if (held.ok) return held.value;
  return { ...emptySummary(0), checked: 0, notReached: 0, busy: true };
}

async function retryUnmatchedNow(
  opts: { ids?: string[]; sinceDays?: number; all?: boolean },
  budget: number,
): Promise<RetrySummary> {
  const started = Date.now();
  const ids =
    opts.ids ?? (await dueReports(new Date(), opts.sinceDays ?? 30, opts.all ?? false));
  const summary: RetrySummary = { ...emptySummary(0), checked: 0, notReached: 0 };
  const ctx = newCtx();
  let i = 0;
  // Always at least one, so even a short budget makes progress.
  for (; i < ids.length && (i === 0 || Date.now() - started < budget); i++) {
    const at = new Date();
    try {
      if (await recheckOne(ctx, ids[i], summary, at)) summary.checked++;
    } catch (e) {
      console.error("FastField retry failed for one report:", errCode(e));
      summary.failed++;
      // Stamped, so it doesn't stay first in line every run.
      await noteFailedAttempt(ids[i], at);
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
  /** The moment used for matching (`FastFieldFacts.when`): the typed time.
   *  Null when none was typed — then nothing is matched by time. */
  at: Date | null;
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
  /** Waiting reports the robot still tries by itself — on a form set to On
   *  and not taken off their activity. Only these are dry-run. */
  robotTries: number;
  /** Waiting reports dry-run through the current rules. */
  checked: number;
  wouldNow: { link: number; create: number; wait: Record<UnmatchedReason, number> };
  reports: FastFieldReviewRow[];
};

/**
 * How the FastField matching is doing for reports filed in [from, to]: the
 * robot's links and creations against those done by hand, and — for each
 * report still waiting that the robot tries by itself — what it would do with
 * it now and what work is recorded at its site. Reads only; the dry run is
 * decide() in preview.
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
  // What the robot's retry tries (dueReports): forms set to On, and never a
  // report taken off its activity — one a person took off waits for a
  // person; one the robot took off only put-back may return, onto a shift.
  const robotTries = { ...filed, status: "UNMATCHED" as const, unlinkedAt: null, form: { mode: "ON" as const } };
  const [byStatus, linkedByHand, created, robotTriesCount, waitingRows] = await Promise.all([
    prisma.fastFieldReport.groupBy({ by: ["status"], where: filed, _count: { _all: true } }),
    prisma.fastFieldReport.count({ where: { ...filed, status: "LINKED", linkedByHand: true } }),
    prisma.fastFieldReport.findMany({
      where: { ...filed, status: "CREATED" },
      select: { jobId: true, note: true },
    }),
    prisma.fastFieldReport.count({ where: robotTries }),
    prisma.fastFieldReport.findMany({
      where: robotTries,
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
  // A job made from a report has a `fastfield_created` line on its history,
  // with the person who made it (none for the robot); older ones only have
  // the note to go on.
  const createdJobIds = created.map((r) => r.jobId).filter((id): id is string => !!id);
  const createdLines = createdJobIds.length
    ? await prisma.activityLog.findMany({
        where: { entity: "Job", action: "fastfield_created", entityId: { in: createdJobIds } },
        select: { entityId: true, userId: true },
      })
    : [];
  const linesByJob = new Map<string, { userId: string | null }[]>();
  for (const l of createdLines) linesByJob.set(l.entityId, [...(linesByJob.get(l.entityId) ?? []), l]);
  const createdByHandCount = created.filter((r) =>
    createdByHand(r, r.jobId ? linesByJob.get(r.jobId) : undefined),
  ).length;

  const ctx = newCtx();
  const wouldNow = {
    link: 0,
    create: 0,
    wait: { site: 0, none: 0, taken: 0, ambiguous: 0, shift: 0, time: 0 } as Record<UnmatchedReason, number>,
  };
  const rows: FastFieldReviewRow[] = [];
  const budget = opts.budgetMs ?? 40_000;

  async function review(r: (typeof waitingRows)[number]): Promise<FastFieldReviewRow> {
    const facts = extractFacts({
      submittedAt: r.submittedAt,
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

    // Work recorded near the report's time — only when a time was typed.
    if (d.site && facts.when) {
      const when = facts.when;
      const [acts, shifts] = await Promise.all([
        candidatesNear(d.site.id, when, 24 * 60),
        shiftsForLinking(d.site.id, when),
      ]);
      const t = when.getTime();
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
    created: { byRobot: created.length - createdByHandCount, byHand: createdByHandCount },
    setAside: count("IGNORED"),
    waiting: count("UNMATCHED"),
    robotTries: robotTriesCount,
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

/** The times a report puts on its activity: only those typed on the form.
 *  Never the phone's opened / finished times or the send time — a time not
 *  typed stays empty (a person can add it on the activity). */
function visitTimes(facts: FastFieldFacts, _report?: StoredReport) {
  const arrived = facts.arrivedAt;
  const departed = facts.departedAt;
  return { arrived, departed, done: departed };
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

const leftForShift = (what: string) =>
  `The ${what} stands for a shift, which is billed itself, so it was left as it is: not marked done, billed or paid.`;

function reportFill(report: StoredReport, facts: FastFieldFacts, officerId: string | null): ReportFill {
  const { arrived, done } = visitTimes(facts, report);
  return {
    arrived,
    done,
    lat: facts.lat,
    lng: facts.lng,
    locatedAt: arrived,
    officerId,
    photoUrls: report.photoUrls,
  };
}

function addFinance(prev: LinkPrev, f: FinanceFilled) {
  if (f.billed) prev.filled.bill = true;
  if (f.paid) prev.filled.pay = true;
}

/** The attach's line on the activity's history (`fastfield_linked` /
 *  `fastfield_created`, or `fastfield_put_back` when the robot puts a report
 *  it took off back on a shift): who (no user = the robot), and exactly what it
 *  changed (`prev`), which Unlink reads to undo it. Ids, times and flags
 *  only. */
async function logAttach(
  tx: Prisma.TransactionClient,
  action: "fastfield_linked" | "fastfield_created" | "fastfield_put_back",
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
    // A job that stands for a shift is billed through its shift: a report
    // linked to it (only ever by hand) leaves it exactly as it is, as with
    // cancelled work — marking it done would bill the shift twice.
    const standsForShift = NOT_MATCHABLE.includes(job.type);
    const { data, prev } = standsForShift
      ? { data: {}, prev: { statusAfter: job.status, cancelled: true as const, filled: {} } }
      : planJobLink(job, fill, UNFINISHED.includes(job.status));
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
        ...linkNote(
          opts.note,
          standsForShift ? leftForShift(what) : prev.cancelled ? leftCancelled(what) : null,
        ),
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
  opts: {
    note?: string;
    ctx?: Ctx;
    byHand?: boolean;
    byUserId?: string;
    /** The shift-history line to write instead of "linked" (put-back). */
    history?: "fastfield_put_back";
  } = {},
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
    // give or take the allowance) — judged by the times typed on the form,
    // so never one with no usable typed time. A person can link any report.
    const window = toShiftCandidate(shift);
    if (!byHand) {
      if (!span) {
        throw new AttachRefused(
          "No usable time was typed on this report, so the robot can't tell whether it fits the shift — link it by hand.",
          "FF_NO_FIT",
        );
      }
      const fit = shiftFit(span, window);
      if (!fit.fits) {
        throw new AttachRefused(
          `This report (${spanText(span)}) ${outsideShiftText(fit)} (${shiftHoursText(
            window,
          )}), more than the ${SHIFT_GRACE_MIN} minutes allowed. A report can only go on a shift it fits.`,
          "FF_NO_FIT",
        );
      }
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
    await logAttach(tx, opts.history ?? "fastfield_linked", "Shift", shift.id, report.id, byHand, {}, opts.byUserId);
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

/** The default note for Bring back on one report, by who took it off (the
 *  skipped-place version, with the person's name, is in fastfieldAdminList). */
function bringBackNoteFor(unlinkedBy: FastFieldUnlinkBy | null): string {
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
          note: note ?? bringBackNoteFor(report.unlinkedBy),
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
  /** The report's typed time; null when none was typed (it can't be checked). */
  span: ReportSpan | null;
  /** The shift's window: earliest of the scheduled / actual start, latest of
   *  the ends. */
  shift: { start: Date; end: Date };
  /** Why the report doesn't fit the shift, or null when it does. */
  outside: string | null;
};

/** Whether a report on a shift fits it, with the allowance (it may have gone
 *  on before the rule, by hand, or the shift's times may have changed since). */
export function checkReportOnShift(
  report: { submittedAt: Date; answers: unknown },
  shift: ShiftTimes,
): ShiftReportCheck {
  const span = reportSpan(
    extractFacts({
      submittedAt: report.submittedAt,
      answers: report.answers as FastFieldAnswer[],
    }),
  );
  const window = toShiftCandidate(shift);
  if (!span) return { span: null, shift: { start: window.start, end: window.end }, outside: NO_TYPED_TIME };
  const fit = shiftFit(span, window);
  return { span, shift: { start: window.start, end: window.end }, outside: fit.fits ? null : outsideShiftText(fit) };
}

/** What "outside the shift" says for a report with no usable typed time: it
 *  can't be checked against the shift, so a person decides. */
export const NO_TYPED_TIME = "has no usable time typed on the form, so it can't be checked against the shift";

export type OutsideShiftRow = ShiftReportCheck & {
  reportId: string;
  shiftId: string;
  siteName: string;
  outside: string;
};

/** How far back Admin → FastField looks for reports on a shift they don't fit. */
export const OUTSIDE_CHECK_DAYS = 14;
/** At most this many reports on shifts are looked at for that list, newest first. */
export const OUTSIDE_SCAN_LIMIT = 2000;

/**
 * Only the answers a report's time can be read from: those whose type says
 * date or time (TIME_ANSWER_TYPES — `answerKind` reads a time from no other
 * answer), in form order. Not the photo lists, notes and everything else in
 * the form, so a list of hundreds of reports stays light.
 */
async function timeAnswersOf(ids: string[]): Promise<Map<string, unknown[]>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; answers: unknown[] | null }[]>`
    SELECT r.id::text AS id,
      (SELECT jsonb_agg(a.answer ORDER BY a.n)
         FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(r.answers) = 'array' THEN r.answers ELSE '[]'::jsonb END
              ) WITH ORDINALITY AS a(answer, n)
        WHERE a.answer->>'type' ~* ${TIME_ANSWER_TYPES.source}) AS answers
    FROM "FastFieldReport" r
    WHERE r.id = ANY(${ids}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.answers ?? []]));
}

/**
 * Reports the robot put on a shift they don't fit inside — they start more
 * than the allowance before it starts or finish more than that after it ends
 * — filed in the last `sinceDays`, newest first (at most OUTSIDE_SCAN_LIMIT
 * looked at). Reports linked by hand are left out: a person put them there on
 * purpose. Each report's time comes from the times typed in it, read in Node
 * from just its date and time answers (timeAnswersOf).
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
    take: OUTSIDE_SCAN_LIMIT,
    select: {
      id: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      shift: { select: { ...SHIFT_TIMES_SELECT, site: { select: { name: true } } } },
    },
  });
  const answers = await timeAnswersOf(rows.map((r) => r.id));
  const out: OutsideShiftRow[] = [];
  for (const r of rows) {
    if (!r.shift) continue;
    const check = checkReportOnShift({ ...r, answers: answers.get(r.id) ?? [] }, r.shift);
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
  /** …that fit their shift (stamped, not looked at again until the shift
   *  changes or the rules version goes up). */
  fit: number;
  /** …moved to another shift at the site that they do fit. */
  moved: number;
  /** …taken off their shift, waiting in Needs linking. */
  takenOff: number;
  /** …that don't fit but have already gone to the client (a client report or
   *  the daily client email), so stay where they are for a person to sort out. */
  kept: number;
  /** Reports the robot had taken off, put back on a shift they now fit. */
  putBack: number;
  /** Reports still attached to an activity that was deleted, taken off it
   *  (put back on a shift they fit, else they wait in Needs linking). */
  released: number;
  /** Whether more were waiting when the time ran out. */
  more: boolean;
  /** True when another copy of the matcher was already running, so this one
   *  did nothing (see RunLock). */
  busy?: boolean;
};

function emptyShiftCheck(): ShiftCheckSummary {
  return { checked: 0, fit: 0, moved: 0, takenOff: 0, kept: 0, putBack: 0, released: 0, more: false };
}

/** Reports checked per database round. */
const SHIFT_CHECK_BATCH = 300;

/** Raw SQL: leave out the reports (`r`) already looked at in this run, so a
 *  batch of reports that all failed doesn't stop the run from reaching older
 *  ones. */
const notTried = (tried: string[]) =>
  tried.length ? Prisma.sql`AND NOT (r.id = ANY(${tried}::uuid[]))` : Prisma.empty;

/**
 * The robot's shift check: a report the robot put on a shift must fit it —
 * not start more than the allowance (SHIFT_GRACE_MIN) before the shift starts
 * nor finish more than that after it ends. Reports a person linked by hand
 * are left where they were put. It looks at each report the robot put on a
 * shift that it hasn't checked yet, whose shift has changed since
 * (`shiftCheckedAt`), or that was last judged under older rules
 * (`rulesVersion` below FASTFIELD_RULES_VERSION) — so after a rules change
 * every such report is judged once more. One that doesn't fit:
 *  - stays put, for a person, if it has already gone to the client
 *    (`sentToClient`: a client report or the daily client email);
 *  - else moves to another shift at the site that it fits;
 *  - else comes off its shift (taken off by the robot) and waits in Needs
 *    linking — the robot never makes or bills a job for it.
 * Each change goes on the shifts' history.
 *
 * First it takes off reports still attached to an activity that was deleted,
 * then puts back reports it took off on a shift they now fit
 * (putBackTakenOff). Runs from the 5-minute recheck until its time budget is
 * spent. When another copy of the matcher is running it does nothing and says
 * `busy`.
 */
export async function checkShiftLinks(
  opts: { budgetMs?: number; now?: Date } = {},
): Promise<ShiftCheckSummary> {
  const budget = opts.budgetMs ?? 15_000;
  const held = await withRunLock(MATCHER_LOCK, budget + LOCK_MARGIN_MS, () =>
    checkShiftLinksNow(budget, opts.now),
  );
  return held.ok ? held.value : { ...emptyShiftCheck(), busy: true };
}

/** `fixedNow`: stamp what was checked with this time instead of the clock. */
async function checkShiftLinksNow(budget: number, fixedNow?: Date): Promise<ShiftCheckSummary> {
  const started = Date.now();
  const summary = emptyShiftCheck();
  const ctx = newCtx();

  // Reports left on an activity that no longer exists come off it first, so
  // put-back can try them straight away.
  await releaseStranded(summary);

  // Then reports the robot took off that may fit a shift now — up to half
  // the time, so the check itself always gets a turn.
  await putBackTakenOff(ctx, started + budget / 2, summary, fixedNow);

  const tried: string[] = [];
  while (Date.now() - started < budget) {
    // Taken before the batch is read: a shift edited while it's being
    // checked is newer than the stamp, so its reports come up again.
    const batchAt = fixedNow ?? new Date();
    const due = await prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "FastFieldReport" r
      JOIN "Shift" s ON s.id = r."shiftId"
      WHERE r.status = 'LINKED'
        AND r."linkedByHand" = false
        AND (r."shiftCheckedAt" IS NULL
          OR s."updatedAt" > r."shiftCheckedAt"
          OR r."rulesVersion" < ${FASTFIELD_RULES_VERSION})
        ${notTried(tried)}
      ORDER BY r."submittedAt" DESC, r.id
      LIMIT ${SHIFT_CHECK_BATCH}`;
    if (due.length === 0) return summary;
    tried.push(...due.map((d) => d.id));
    const rows = await prisma.fastFieldReport.findMany({
      where: { id: { in: due.map((d) => d.id) }, status: "LINKED", linkedByHand: false },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        submittedAt: true,
        startedAt: true,
        finishedAt: true,
        answers: true,
        formSubmissionId: true,
        shift: { select: { ...SHIFT_TIMES_SELECT, siteId: true } },
        formSubmission: { select: { review: { select: { id: true } } } },
      },
    });
    const fitting: string[] = [];
    let outOfTime = false;
    for (const r of rows) {
      if (!r.shift) continue;
      if (Date.now() - started >= budget) {
        outOfTime = true;
        break;
      }
      summary.checked++;
      try {
        const outcome = await checkOneShiftLink(ctx, r, r.shift, batchAt);
        if (outcome === "fit") fitting.push(r.id);
        else summary[outcome]++;
      } catch (e) {
        console.error("FastField shift check failed for one report:", errCode(e));
      }
    }
    if (fitting.length) {
      await prisma.fastFieldReport.updateMany({
        where: { id: { in: fitting }, status: "LINKED", linkedByHand: false },
        data: { shiftCheckedAt: batchAt, rulesVersion: FASTFIELD_RULES_VERSION },
      });
      summary.fit += fitting.length;
    }
    if (outOfTime) {
      summary.more = true;
      return summary;
    }
    if (due.length < SHIFT_CHECK_BATCH) return summary;
  }
  summary.more = true;
  return summary;
}

/** How long before its send time a report's typed times can be (the form's
 *  times are read up to 72 hours before it was sent: lib/fastfield.ts). */
const TYPED_BEFORE_SEND_MS = 72 * 3_600_000;
/** Shifts that start up to this long after a report's send time can be
 *  "near" it (typed times run a little past the send time, plus an hour). */
const NEAR_AFTER_SEND_MS = 2 * 3_600_000;
/** A shift changing near them brings up robot take-offs filed in the last
 *  this-many days (the retry also looks back 30 days). */
const PUT_BACK_DAYS = 30;

/**
 * Reports the robot took off (a shift they didn't fit, or an activity that
 * was deleted: `unlinkedBy` ROBOT) go back on a shift at their site that they
 * now fit — shifts only: never a job or visit, never a new job. Each is
 * looked at once after it came off, again after the rules version goes up,
 * and — for reports filed in the last 30 days — once a shift near its time
 * at its site is added or changed since it was last looked at (`checkedAt`).
 * "Near" is judged from the send time, as a report's typed times are in its
 * answers: shifts that started from 36 hours before its earliest possible
 * typed time to an hour after its latest. Reports a person took off stay off.
 */
async function putBackTakenOff(
  ctx: Ctx,
  until: number,
  summary: ShiftCheckSummary,
  fixedNow?: Date,
): Promise<void> {
  const before = Prisma.sql`${Math.round((SHIFT_REACH_MS + TYPED_BEFORE_SEND_MS) / 1000)} * interval '1 second'`;
  const after = Prisma.sql`${Math.round(NEAR_AFTER_SEND_MS / 1000)} * interval '1 second'`;
  const since = asStored(new Date((fixedNow ?? new Date()).getTime() - PUT_BACK_DAYS * 86_400_000));
  const tried: string[] = [];
  for (;;) {
    const due = await prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "FastFieldReport" r
      WHERE r.status = 'UNMATCHED'
        AND r."unlinkedAt" IS NOT NULL
        AND r."unlinkedBy" = 'ROBOT'
        AND r."siteId" IS NOT NULL
        AND (r."checkedAt" IS NULL
          OR r."rulesVersion" < ${FASTFIELD_RULES_VERSION}
          OR (r."submittedAt" >= ${since}
            AND EXISTS (
              SELECT 1 FROM "Shift" s
              WHERE s."siteId" = r."siteId"
                AND s."updatedAt" > r."checkedAt"
                AND (s."scheduledStartsAt" BETWEEN r."submittedAt" - ${before} AND r."submittedAt" + ${after}
                  OR s."actualStartedAt" BETWEEN r."submittedAt" - ${before} AND r."submittedAt" + ${after}))))
        ${notTried(tried)}
      ORDER BY r."submittedAt" DESC, r.id
      LIMIT ${SHIFT_CHECK_BATCH}`;
    for (const { id } of due) {
      if (Date.now() >= until) {
        summary.more = true;
        return;
      }
      tried.push(id);
      await putBackOne(ctx, id, summary, fixedNow);
    }
    if (due.length < SHIFT_CHECK_BATCH) return;
  }
}

async function putBackOne(ctx: Ctx, id: string, summary: ShiftCheckSummary, fixedNow?: Date): Promise<void> {
  // Taken before the report and the shifts are read (see checkShiftLinksNow).
  const at = fixedNow ?? new Date();
  try {
    const r = await prisma.fastFieldReport.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        siteId: true,
        unlinkedBy: true,
        submittedAt: true,
        startedAt: true,
        finishedAt: true,
        answers: true,
      },
    });
    if (!r || r.status !== "UNMATCHED" || !r.siteId || r.unlinkedBy !== "ROBOT") return;
    const facts = extractFacts({
      submittedAt: r.submittedAt,
      answers: r.answers as FastFieldAnswer[],
    });
    const span = reportSpan(facts);
    // No usable typed time: it can't be shown to fit any shift, so it stays
    // for a person (stamped below).
    const ps = span
      ? pickShift(span, await shiftsNear(r.siteId, span.from), await officerFor(ctx, facts))
      : { pick: null };
    if (ps.pick) {
      const res = await linkReportToShift(r.id, ps.pick.id, {
        ctx,
        note: `Put back on the shift ${shiftHoursText(ps.pick)} by the robot: it fits with the ${SHIFT_GRACE_MIN}-minute allowance.`,
        // One history line, written with the link itself.
        history: "fastfield_put_back",
      });
      if (res.ok) {
        summary.putBack++;
        return;
      }
    }
    // Fits no shift (or couldn't go on it): not looked at again until a shift
    // near it changes, or the rules do.
    await prisma.fastFieldReport.updateMany({
      where: { id: r.id, status: "UNMATCHED", unlinkedBy: "ROBOT" },
      data: { checkedAt: at, rulesVersion: FASTFIELD_RULES_VERSION },
    });
  } catch (e) {
    console.error("FastField put-back failed for one report:", errCode(e));
  }
}

/** What the shift check does with one report the robot put on a shift.
 *  `now`: when the data it judges by was read (the batch's start). */
async function checkOneShiftLink(
  ctx: Ctx,
  r: {
    id: string;
    submittedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    answers: unknown;
    formSubmissionId: string | null;
    formSubmission: { review: { id: string } | null } | null;
  },
  shift: ShiftTimes & { siteId: string },
  now: Date,
): Promise<"fit" | "moved" | "takenOff" | "kept"> {
  const facts = extractFacts({
    submittedAt: r.submittedAt,
    answers: r.answers as FastFieldAnswer[],
  });
  const span = reportSpan(facts);
  const current = toShiftCandidate(shift);
  // No usable typed time (a link made before typed times were all that
  // counted): nothing says when the round was done, so it can't be judged —
  // neither moved nor taken off. It's kept, and shows for a person in "On a
  // shift, outside its time" (checkReportOnShift flags it).
  if (!span) {
    await prisma.fastFieldReport.updateMany({
      where: { id: r.id, status: "LINKED", shiftId: shift.id, linkedByHand: false },
      data: { shiftCheckedAt: now, rulesVersion: FASTFIELD_RULES_VERSION },
    });
    return "kept";
  }
  if (shiftFit(span, current).fits) return "fit";

  // Already gone to the client from this shift: neither moved nor taken off.
  // It stays for a person (in "On a shift, outside its time"), not looked at
  // again until the shift changes or the rules do.
  if ((await sentToClient(r)).sent) {
    await prisma.fastFieldReport.updateMany({
      where: { id: r.id, status: "LINKED", shiftId: shift.id, linkedByHand: false },
      data: { shiftCheckedAt: now, rulesVersion: FASTFIELD_RULES_VERSION },
    });
    return "kept";
  }

  const others = await shiftsNear(shift.siteId, span.from);
  const action = shiftLinkAction(span, current, others, await officerFor(ctx, facts));
  if (action.kind === "fit") return "fit";
  const why = `the report (${spanText(span)}) ${outsideShiftText(action.why)}`;

  if (action.kind === "move") {
    const to = action.to;
    await prisma.$transaction(async (tx) => {
      // Only while it's still the robot's link to this shift (P2025 rolls
      // back otherwise). A move keeps when it was linked (`linkedAt`).
      await tx.fastFieldReport.update({
        where: { id: r.id, status: "LINKED", shiftId: shift.id, linkedByHand: false },
        data: {
          shiftId: to.id,
          shiftCheckedAt: now,
          rulesVersion: FASTFIELD_RULES_VERSION,
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

// ── Reports whose activity is deleted ─────────────────────────────────────

/** Why reports came off a deleted activity (the `fastfield_released` history). */
export type ReleaseReason =
  | "shift_deleted"
  | "shift_cancelled_by_partner"
  | "data_reset"
  | "activity_deleted";

type ReleaseRow = {
  id: string;
  formSubmissionId: string | null;
  shiftId: string | null;
  siteId: string | null;
};

const RELEASED_REFIT =
  " If it fits another shift there, the robot puts it on that one; if not, link it to the right activity or set it aside.";
const RELEASED_WAITS = " Link it to the right activity or set it aside.";

/**
 * Take the FastField reports off shifts that are about to be deleted (by
 * staff, or by the partner who recorded them), so none is left attached to
 * nothing. Each report's patrol round (its submission and approved review)
 * goes — unless it has client reports, kept as the record of what was sent —
 * and the report waits again (UNMATCHED), taken off by the robot: the
 * put-back may put it on another shift there that it fits; otherwise it
 * waits for a person — the robot never makes a job for it. A hand link comes
 * off too. Pass the caller's transaction as `tx` to do it together with the
 * delete. Returns how many came off.
 */
export async function releaseShiftReports(
  shiftIds: string[],
  reason: Extract<ReleaseReason, "shift_deleted" | "shift_cancelled_by_partner">,
  opts: { byUserId?: string | null; byName?: string | null; tx?: Prisma.TransactionClient } = {},
): Promise<number> {
  if (shiftIds.length === 0) return 0;
  const run = async (tx: Prisma.TransactionClient) => {
    const rows = await lockReports(
      tx,
      Prisma.sql`r."shiftId" = ANY(${shiftIds}::uuid[]) AND r.status = 'LINKED'`,
    );
    if (rows.length === 0) return 0;
    const shifts = await tx.shift.findMany({ where: { id: { in: shiftIds } }, select: SHIFT_TIMES_SELECT });
    const hours = new Map(shifts.map((s) => [s.id, shiftHoursText(toShiftCandidate(s))]));
    const what = reason === "shift_deleted" ? `was deleted${opts.byName ? ` by ${opts.byName}` : ""}` : "was cancelled by the partner who recorded it";
    return releaseRows(
      tx,
      rows,
      (row) => {
        const h = row.shiftId ? hours.get(row.shiftId) : undefined;
        return `Its shift${h ? ` (${h})` : ""} ${what}, so it came off it.${row.siteId ? RELEASED_REFIT : RELEASED_WAITS}`;
      },
      reason,
      opts.byUserId ?? null,
    );
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction(run);
}

/**
 * Take every attached FastField report off its activity, ahead of a reset
 * that deletes every site and everything on them (Admin → Imports → Nexus →
 * reset sites). Their rounds go with them; the reports wait in Needs linking
 * for a person, as their sites go too. Pass the reset's transaction as `tx`.
 */
export async function releaseAllAttachedReports(
  opts: { byUserId?: string | null; tx?: Prisma.TransactionClient } = {},
): Promise<number> {
  const run = async (tx: Prisma.TransactionClient) => {
    const rows = await lockReports(tx, Prisma.sql`r.status IN ('LINKED', 'CREATED')`);
    return releaseRows(
      tx,
      rows,
      () => `Its activity was deleted when the site data was reset, so it came off it.${RELEASED_WAITS}`,
      "data_reset",
      opts.byUserId ?? null,
    );
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction(run, { timeout: 60_000 });
}

/** Reports still attached to an activity that was deleted under them —
 *  LINKED or CREATED with no shift, job or visit (deleted by something that
 *  didn't take them off first) — taken off it, as releaseShiftReports does. */
async function releaseStranded(summary: ShiftCheckSummary): Promise<void> {
  try {
    const any = await prisma.fastFieldReport.findFirst({
      where: { status: { in: ["LINKED", "CREATED"] }, shiftId: null, jobId: null, patrolVisitId: null },
      select: { id: true },
    });
    if (!any) return;
    summary.released += await prisma.$transaction(async (tx) => {
      const rows = await lockReports(
        tx,
        Prisma.sql`r.status IN ('LINKED', 'CREATED') AND r."shiftId" IS NULL AND r."jobId" IS NULL AND r."patrolVisitId" IS NULL`,
        SHIFT_CHECK_BATCH,
      );
      if (rows.length === SHIFT_CHECK_BATCH) summary.more = true;
      return releaseRows(
        tx,
        rows,
        (row) => `Its activity was deleted, so it came off it.${row.siteId ? RELEASED_REFIT : RELEASED_WAITS}`,
        "activity_deleted",
        null,
      );
    });
  } catch (e) {
    console.error("FastField: reports on deleted activities not taken off:", errCode(e));
  }
}

/** The reports (`r`) matching `where`, newest first, locked until the
 *  transaction ends so nothing changes them meanwhile. */
async function lockReports(
  tx: Prisma.TransactionClient,
  where: Prisma.Sql,
  limit?: number,
): Promise<ReleaseRow[]> {
  return tx.$queryRaw<ReleaseRow[]>`
    SELECT r.id, r."formSubmissionId", r."shiftId", r."siteId"
    FROM "FastFieldReport" r
    WHERE ${where}
    ORDER BY r."submittedAt" DESC, r.id
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
    FOR UPDATE`;
}

/** In slices, so a reset of thousands of reports stays within the database's
 *  limit on query parameters. */
function inSlices<T>(xs: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Take locked reports off their activity (see releaseShiftReports). */
async function releaseRows(
  tx: Prisma.TransactionClient,
  rows: ReleaseRow[],
  noteFor: (row: ReleaseRow) => string,
  reason: ReleaseReason,
  byUserId: string | null,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  const byNote = new Map<string, string[]>();
  for (const row of rows) {
    const note = noteFor(row);
    byNote.set(note, [...(byNote.get(note) ?? []), row.id]);
  }
  let released = 0;
  for (const [note, ids] of Array.from(byNote.entries())) {
    for (const slice of inSlices(ids)) {
      const res = await tx.fastFieldReport.updateMany({
        where: { id: { in: slice }, status: { in: ["LINKED", "CREATED"] } },
        data: {
          status: "UNMATCHED",
          shiftId: null,
          jobId: null,
          patrolVisitId: null,
          formSubmissionId: null,
          jobCreated: false,
          linkedAt: null,
          linkedByHand: false,
          unlinkedAt: now,
          unlinkedBy: "ROBOT",
          // Due for the put-back straight away.
          checkedAt: null,
          rulesVersion: FASTFIELD_RULES_VERSION,
          note,
        },
      });
      released += res.count;
    }
  }
  // Their rounds go; each approved review goes with its submission (cascade)
  // — except one with client reports, kept as the record of what was sent.
  const submissionIds = rows.map((r) => r.formSubmissionId).filter((x): x is string => !!x);
  for (const slice of inSlices(submissionIds)) {
    await tx.formSubmission.deleteMany({
      where: {
        id: { in: slice },
        OR: [{ review: { is: null } }, { review: { clientReports: { none: {} } } }],
      },
    });
  }
  for (const slice of inSlices(rows)) {
    await tx.activityLog.createMany({
      data: slice.map((row) => ({
        entity: "FastFieldReport",
        entityId: row.id,
        action: "fastfield_released",
        userId: byUserId,
        diff: { reason, ...(row.shiftId ? { shiftId: row.shiftId } : {}) },
      })),
    });
  }
  return released;
}

// ── Skipped places ────────────────────────────────────────────────────────

const skipNote = (label: string) => `Set aside: "${label}" is a skipped place.`;

/** A skip's history line: the place as shown (short), and the counts. */
const skipLabel = (label: string) => label.slice(0, 80);

/**
 * Waiting reports grouped by the place typed (Admin → FastField → Waiting, by
 * place), counted in the database: one row per spelling and matched site, not
 * one per waiting report.
 */
export async function waitingPlaces() {
  const rows = await prisma.fastFieldReport.groupBy({
    by: ["siteText", "siteId"],
    where: { status: "UNMATCHED", siteText: { not: null } },
    _count: { _all: true },
    _max: { submittedAt: true },
  });
  const siteIds = [...new Set(rows.map((r) => r.siteId).filter((id): id is string => !!id))];
  const sites = siteIds.length
    ? await prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(sites.map((s) => [s.id, s.name]));
  return placesFromCounts(
    rows.map((r) => ({
      siteText: r.siteText,
      siteName: r.siteId ? (names.get(r.siteId) ?? null) : null,
      count: r._count._all,
      latest: r._max.submittedAt ?? new Date(0),
    })),
  );
}

/**
 * Skip a place: set aside every waiting report whose site, as typed, is the
 * same place (siteKey) — and new ones as they arrive, unless they match an
 * activity. Skipping a place that's already skipped sets aside any report
 * typed like it that's waiting again. Written on the history as
 * `fastfield_skip_place` (with who did it).
 */
export async function skipPlace(
  key: string,
  by: string,
  opts: { byUserId?: string | null } = {},
): Promise<{ ok: true; label: string; setAside: number; skipId: string } | { ok: false; error: string }> {
  if (!key || siteKey(key) !== key) return { ok: false, error: "That place doesn't look right." };
  // The ways this place is typed among the waiting reports, counted in the
  // database — one row per spelling, not one per report.
  const spellings = (
    await prisma.fastFieldReport.groupBy({
      by: ["siteText"],
      where: { status: "UNMATCHED", siteText: { not: null } },
      _count: { _all: true },
      _max: { submittedAt: true },
    })
  ).filter((r) => siteKey(r.siteText) === key);
  const label =
    placesFromCounts(
      spellings.map((r) => ({
        siteText: r.siteText,
        siteName: null,
        count: r._count._all,
        latest: r._max.submittedAt ?? new Date(0),
      })),
    )[0]?.label ?? key;
  return prisma.$transaction(async (tx) => {
    const skip = await tx.fastFieldSkip.upsert({
      where: { siteKey: key },
      create: { siteKey: key, label: label.slice(0, 200), createdBy: by },
      update: {},
      select: { id: true, label: true },
    });
    const res = spellings.length
      ? await tx.fastFieldReport.updateMany({
          where: { status: "UNMATCHED", siteText: { in: spellings.map((r) => r.siteText!) } },
          data: { status: "IGNORED", skipId: skip.id, note: skipNote(skip.label) },
        })
      : { count: 0 };
    await tx.activityLog.create({
      data: {
        entity: "FastFieldSkip",
        entityId: skip.id,
        action: "fastfield_skip_place",
        userId: opts.byUserId ?? null,
        diff: { label: skipLabel(skip.label), setAside: res.count },
      },
    });
    return { ok: true as const, label: skip.label, setAside: res.count, skipId: skip.id };
  });
}

/**
 * Stop skipping a place: the reports it set aside wait again, and new ones
 * typed like it wait as usual. Who took a report off a shift decides what
 * happens next: one never taken off, the robot tries again; one the robot
 * took off, the robot may put back on a shift it fits (never a job or visit);
 * one a person took off waits for a person. Each gets a note saying which
 * (broughtBackNote). Written on the history as `fastfield_stop_skipping`
 * (with who did it).
 */
export async function stopSkipping(
  skipId: string,
  by: string,
  opts: { byUserId?: string | null } = {},
): Promise<
  | { ok: true; label: string; broughtBack: number; waitForYou: number }
  | { ok: false; error: string }
> {
  const skip = await prisma.fastFieldSkip.findUnique({ where: { id: skipId }, select: { id: true, label: true } });
  if (!skip) return { ok: false, error: "That place isn't skipped any more." };
  const setAside = { skipId: skip.id, status: "IGNORED" as const };
  const back = { status: "UNMATCHED" as const, skipId: null };
  return prisma.$transaction(async (tx) => {
    // Never taken off a shift: tried again soon (checkedAt cleared).
    const tries = await tx.fastFieldReport.updateMany({
      where: { ...setAside, unlinkedAt: null },
      data: { ...back, checkedAt: null, note: broughtBackNote(by, "robot_tries") },
    });
    // Taken off by the robot: put-back looks at it again soon (checkedAt cleared).
    const putsBack = await tx.fastFieldReport.updateMany({
      where: { ...setAside, unlinkedAt: { not: null }, unlinkedBy: "ROBOT" },
      data: { ...back, checkedAt: null, note: broughtBackNote(by, "robot_puts_back") },
    });
    // Taken off by a person (or nobody knows who): left for a person.
    const waits = await tx.fastFieldReport.updateMany({
      where: { ...setAside, unlinkedAt: { not: null }, OR: [{ unlinkedBy: "PERSON" }, { unlinkedBy: null }] },
      data: { ...back, note: broughtBackNote(by, "waits_for_you") },
    });
    const gone = await tx.fastFieldSkip.deleteMany({ where: { id: skip.id } });
    const broughtBack = tries.count + putsBack.count + waits.count;
    // Someone else stopped skipping it a moment ago: nothing was left to do.
    if (gone.count === 0 && broughtBack === 0) {
      return { ok: false as const, error: "That place isn't skipped any more." };
    }
    await tx.activityLog.create({
      data: {
        entity: "FastFieldSkip",
        entityId: skip.id,
        action: "fastfield_stop_skipping",
        userId: opts.byUserId ?? null,
        diff: {
          label: skipLabel(skip.label),
          broughtBack,
          robotTries: tries.count,
          robotPutsBack: putsBack.count,
          waitForYou: waits.count,
        },
      },
    });
    return { ok: true as const, label: skip.label, broughtBack, waitForYou: waits.count };
  });
}

export type NearbyActivity = {
  kind: "job" | "visit" | "shift";
  id: string;
  /** The JobType for a job; "PATROL" or "VPI" (its schedule's kind) for a
   *  visit; the ShiftType for a shift. */
  type: string;
  /** Its own status (JobStatus / VisitStatus / ShiftStatus). */
  status: string;
  /** Shifts: the start of the window; jobs and visits: their time nearest
   *  the report's own time. */
  at: Date;
  /** Shifts: the end of the window. */
  until?: Date;
  /** Shifts: how far the report runs past it (0 strictly inside); jobs and
   *  visits: minutes from the report's own time (0 within it). */
  minutesApart: number;
  /** Jobs and visits: which side of the report's own time `at` is. */
  side?: "before" | "during" | "after";
  /** Shifts: why the report doesn't fit it ("started 45 min before the
   *  shift"), or null when it fits. Either way a person can link it. */
  outside?: string | null;
  /** Jobs and visits: already has a report (a FastField one or the officer's
   *  own). A shift takes any number. */
  taken: boolean;
  /** Handled by a partner. */
  partner: boolean;
  /** Jobs: the job a patrol visit stands on (the robot links the visit). */
  forVisit?: boolean;
  /** Linking it marks it done: a job or visit that isn't finished yet. */
  marksDone: boolean;
  /** The report has no usable typed time: nothing to compare this row with
   *  (no fit, no "minutes apart"). A person decides. */
  untimed?: boolean;
};

export type HandLinkActivities = {
  rows: NearbyActivity[];
  /** A kind had more than HAND_LINK_TAKE in the window: not all are listed. */
  more: boolean;
};

/** Of an activity's times, the one nearest a report's own time: how far it
 *  is (0 within the report's span) and on which side. */
export function nearestToSpan(
  times: Date[],
  span: ReportSpan,
): { at: Date; minutes: number; side: "before" | "during" | "after" } {
  let best: { at: Date; minutes: number; side: "before" | "during" | "after" } | null = null;
  for (const t of times) {
    const ms = t.getTime();
    const side = ms < span.from.getTime() ? "before" : ms > span.to.getTime() ? "after" : "during";
    const minutes =
      side === "before"
        ? (span.from.getTime() - ms) / 60000
        : side === "after"
          ? (ms - span.to.getTime()) / 60000
          : 0;
    if (!best || minutes < best.minutes) best = { at: t, minutes, side };
  }
  if (!best) return { at: span.from, minutes: 0, side: "during" };
  return { ...best, minutes: Math.round(best.minutes) };
}

/** The hand-link list's order: the shifts the report fits first, then the
 *  rest, nearest first (then earliest). */
export function sortForLinking(rows: NearbyActivity[]): NearbyActivity[] {
  const fits = (r: NearbyActivity) => r.kind === "shift" && !r.outside;
  return [...rows].sort(
    (a, b) =>
      Number(fits(b)) - Number(fits(a)) ||
      a.minutesApart - b.minutesApart ||
      a.at.getTime() - b.at.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Everything at a site within [window.from, window.to], for linking a report
 * by hand (lib/fastfieldHandLink.ts picks the window: days either side of the
 * report, or one day). A person can link a report to any activity, so nothing
 * is left out — cancelled, a partner's, already reported, a shift's job, a
 * shift the report doesn't fit: the page marks what the robot would skip
 * (handLinkMarkers). Not the robot's search (`candidatesNear`,
 * `shiftsNearSites`), which keeps to 3 hours (or 18) and skips all that.
 */
export async function activitiesNearReport(
  reportId: string,
  siteId: string,
  window: { from: Date; to: Date },
): Promise<HandLinkActivities> {
  const report = await prisma.fastFieldReport.findUnique({
    where: { id: reportId },
    select: REPORT_SELECT,
  });
  if (!report) return { rows: [], more: false };
  const facts = factsOf(report);
  // Typed times only; with none, rows aren't compared with the report.
  const span = reportSpan(facts);
  const range = { gte: window.from, lte: window.to };
  const near = (times: Date[], fallback: Date) =>
    span
      ? nearestToSpan(times.length ? times : [fallback], span)
      : { at: times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : fallback, minutes: 0, side: undefined };
  const [jobs, visits, shifts] = await Promise.all([
    prisma.job.findMany({
      where: {
        siteId,
        OR: [
          { scheduledFor: range },
          { startedAt: range },
          { completedAt: range },
          { scheduledFor: null, startedAt: null, completedAt: null, createdAt: range },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: HAND_LINK_TAKE + 1,
      select: {
        id: true,
        type: true,
        status: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        handledByPartnerId: true,
        patrolVisitId: true,
        _count: { select: { fastfieldReports: true, formSubmissions: true } },
      },
    }),
    prisma.patrolVisit.findMany({
      where: { siteId, OR: [{ scheduledAt: range }, { arrivedAt: range }, { departedAt: range }] },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: HAND_LINK_TAKE + 1,
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        arrivedAt: true,
        departedAt: true,
        handledByPartnerId: true,
        patrolSchedule: { select: { kind: true } },
        _count: { select: { fastfieldReports: true, formSubmissions: true } },
      },
    }),
    shiftsForLinking(siteId, window.from, window, HAND_LINK_TAKE + 1),
  ]);
  const present = (ds: (Date | null)[]) => ds.filter((d): d is Date => d != null);
  const shiftRows: NearbyActivity[] = shifts.slice(0, HAND_LINK_TAKE).map((s) => {
    const fit = span ? shiftFit(span, s) : null;
    return {
      kind: "shift",
      id: s.id,
      type: s.type,
      status: s.status,
      at: s.start,
      until: s.end,
      minutesApart: span ? shiftApartMin(span, s) : 0,
      outside: !fit || fit.fits ? null : outsideShiftText(fit),
      taken: false,
      partner: s.partner,
      marksDone: false,
      ...(span ? {} : { untimed: true }),
    };
  });
  const jobRows: NearbyActivity[] = jobs.slice(0, HAND_LINK_TAKE).map((j) => {
    const n = near(present([j.scheduledFor, j.startedAt, j.completedAt]), j.createdAt);
    return {
      kind: "job",
      id: j.id,
      type: j.type,
      status: j.status,
      at: n.at,
      minutesApart: n.minutes,
      side: n.side,
      ...(span ? {} : { untimed: true }),
      taken: j._count.fastfieldReports + j._count.formSubmissions > 0,
      partner: j.handledByPartnerId != null,
      forVisit: j.patrolVisitId != null,
      // A job that stands for a shift is never changed by a link.
      marksDone: UNFINISHED.includes(j.status) && !NOT_MATCHABLE.includes(j.type),
    };
  });
  const visitRows: NearbyActivity[] = visits.slice(0, HAND_LINK_TAKE).map((v) => {
    const n = near(present([v.scheduledAt, v.arrivedAt, v.departedAt]), v.scheduledAt);
    return {
      kind: "visit",
      id: v.id,
      type: v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL",
      status: v.status,
      at: n.at,
      minutesApart: n.minutes,
      side: n.side,
      ...(span ? {} : { untimed: true }),
      taken: v._count.fastfieldReports + v._count.formSubmissions > 0,
      partner: v.handledByPartnerId != null,
      marksDone: VISIT_UNFINISHED.includes(v.status),
    };
  });
  return {
    rows: sortForLinking([...shiftRows, ...jobRows, ...visitRows]),
    more:
      shifts.length > HAND_LINK_TAKE || jobs.length > HAND_LINK_TAKE || visits.length > HAND_LINK_TAKE,
  };
}
