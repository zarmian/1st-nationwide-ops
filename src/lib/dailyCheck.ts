/**
 * Daily check — each morning (cron daily-check) look over everything since
 * the last check and tell the office what needs a look:
 *
 *   - Possible duplicates: the same visit recorded twice at a site (our
 *     scheduled patrol and the Nexus activity for it, a callout logged by the
 *     office and one made from a FastField report, …).
 *   - Missing reports: our own officers' jobs, patrols and static shifts with
 *     no report attached. Work reported in Nexus's or Keyholding's own apps
 *     isn't expected here and is left out.
 *   - Report problems: FastField reports whose GPS was far from the site, whose
 *     typed site name or postcode points elsewhere, whose form doesn't fit the
 *     job, or whose officer isn't on the staff list.
 *   - Incidents: Claude reads the reports and lists real incidents / security
 *     issues (keyword scan if Claude isn't configured).
 *   - Syncs: whether Nexus, Keyholding and FastField have synced lately.
 *
 * A check covers activities from the end of the last morning check up to an
 * hour before the FastField robot's latest run, so every activity is checked
 * once, after its report has had time to come in. "Run now" on the admin page
 * checks the same span without moving it. The rules live in dailyCheckRules.ts.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { extractWithTool, isAnthropicConfigured } from "@/lib/anthropic";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { extractFacts, pickOfficer, type FastFieldAnswer } from "@/lib/fastfield";
import { matchSite, type SiteCandidate } from "@/lib/telegramCallout";
import { NEXUS_PARTNER_NAME } from "@/lib/nexusImport";
import { resolveKeyholdingCustomer } from "@/lib/keyholdingJobs";
import {
  familyOf,
  findDuplicatePairs,
  keywordIncidents,
  reportIssues,
  reportText,
  samePlaceIds,
  type CheckActivity,
} from "@/lib/dailyCheckRules";

// ── What a check records ──────────────────────────────────────────────────

export type FoundActivity = {
  kind: "job" | "visit" | "shift";
  id: string;
  type: string;
  source: string;
  /** ISO time shown for it. */
  at: string;
  status: string;
};

export type DuplicateFinding = { siteId: string; siteName: string; items: FoundActivity[] };
export type MissingFinding = { siteId: string; siteName: string; item: FoundActivity; why: string };
export type ReportIssueFinding = {
  reportId: string;
  siteName: string | null;
  form: string;
  at: string;
  officer: string | null;
  issues: string[];
};
export type IncidentFinding = {
  reportId: string;
  siteName: string | null;
  at: string;
  severity: "high" | "medium" | "low";
  category: string;
  summary: string;
};
export type SyncFinding = { name: string; lastSeen: string | null; stale: boolean };

export type DailyCheckFindings = {
  period: { from: string; until: string };
  duplicates: DuplicateFinding[];
  missing: MissingFinding[];
  /** Why missing reports weren't checked, when they weren't. */
  missingSkipped: string | null;
  reportIssues: ReportIssueFinding[];
  /** Reports still waiting to be linked by hand (all, not just new). */
  unmatchedReports: number;
  incidents: IncidentFinding[];
  /** Who read the reports for incidents. */
  incidentsBy: "claude" | "keywords";
  /** Why Claude wasn't used, when it wasn't. */
  claudeNote: string | null;
  reportsRead: number;
  syncs: SyncFinding[];
};

export type DailyCheckCounts = {
  duplicates: number;
  missing: number;
  reportIssues: number;
  unmatched: number;
  incidents: number;
  staleSyncs: number;
  /** Everything that needs a look. */
  total: number;
};

// ── Settings ──────────────────────────────────────────────────────────────

export async function getDailyCheckSettings(): Promise<{ enabled: boolean; recipients: string | null }> {
  const row = await prisma.dailyCheckSettings.findUnique({ where: { id: 1 } });
  return { enabled: row?.enabled ?? true, recipients: row?.recipients ?? null };
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** The addresses the check goes to: the settings, else ADMIN_EMAIL. */
export function recipientsFrom(setting: string | null): string[] {
  const list = (setting ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));
  if (list.length) return list;
  const admin = process.env.ADMIN_EMAIL?.trim();
  return admin && EMAIL_RE.test(admin) ? [admin] : [];
}

// ── The period ────────────────────────────────────────────────────────────

const HOUR = 3_600_000;

async function checkPeriod(now: Date): Promise<{ from: Date; until: Date; robotSeen: Date | null }> {
  const [last, robot] = await Promise.all([
    prisma.dailyCheck.findFirst({
      where: { trigger: "cron" },
      orderBy: { createdAt: "desc" },
      select: { periodEnd: true },
    }),
    prisma.fastFieldForm.aggregate({ _max: { lastSeenAt: true } }),
  ]);
  const robotSeen = robot._max.lastSeenAt ?? null;
  let from = last?.periodEnd ?? new Date(now.getTime() - 24 * HOUR);
  // Up to an hour before the robot last ran, so reports have come in.
  let until =
    robotSeen && robotSeen.getTime() - HOUR > from.getTime()
      ? new Date(Math.min(now.getTime(), robotSeen.getTime() - HOUR))
      : new Date(now.getTime() - HOUR);
  if (until.getTime() <= from.getTime()) until = now;
  if (until.getTime() - from.getTime() > 7 * 24 * HOUR) {
    from = new Date(until.getTime() - 7 * 24 * HOUR);
  }
  return { from, until, robotSeen };
}

// ── Gathering ─────────────────────────────────────────────────────────────

const inPeriod = (d: Date, from: Date, until: Date) =>
  d.getTime() >= from.getTime() && d.getTime() < until.getTime();

const present = (ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => d != null);

const ACTIVITY_TYPES = [
  "ALARM_RESPONSE",
  "ADHOC",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "SURVEY",
  "PATROL",
  "VPI",
  "LOCK",
  "UNLOCK",
] as const;

const DONE_JOB = new Set(["SUBMITTED", "REVIEW_PENDING", "APPROVED", "SENT_TO_CLIENT", "CLOSED"]);

type JobRow = {
  id: string;
  type: string;
  source: string;
  status: string;
  siteId: string | null;
  customerId: string | null;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  partnerActivityRef: string | null;
  recordedByUserId: string | null;
  reportedViaPartnerApp: boolean;
  handledByPartnerId: string | null;
  patrolVisitId: string | null;
  site: { name: string; postcode: string; partnerId: string | null; customerId: string | null } | null;
  fastfieldReports: { id: string }[];
  _count: { formSubmissions: number; fastfieldReports: number };
};

function jobSource(j: JobRow, keyholdingId: string | null): string {
  if (j.partnerActivityRef?.startsWith("LINK-")) return "Nexus";
  if (j.partnerActivityRef) {
    return keyholdingId && j.customerId === keyholdingId ? "Keyholding" : "Partner import";
  }
  if (j.fastfieldReports.length) return "FastField report";
  if (j.recordedByUserId) return "Recorded by the office";
  if (j.source === "SCHEDULED") return "Our schedule";
  return "Dispatch";
}

function jobMain(j: { scheduledFor: Date | null; startedAt: Date | null; completedAt: Date | null; createdAt: Date }) {
  return j.startedAt ?? j.scheduledFor ?? j.completedAt ?? j.createdAt;
}

/** Partners and customers whose own apps our officers report in (Nexus,
 *  Keyholding) — their work isn't expected to have a report here. */
type ReportedElsewhere = { partnerIds: Set<string>; customerIds: Set<string> };

/** What's left out of "missing reports": partner-app work and those sites. */
function reportedElsewhere(
  a: {
    reportedViaPartnerApp: boolean;
    handledByPartnerId: string | null;
    site: { partnerId: string | null; customerId: string | null } | null;
  },
  elsewhere: ReportedElsewhere,
): boolean {
  return (
    a.reportedViaPartnerApp ||
    a.handledByPartnerId != null ||
    (a.site?.partnerId != null && elsewhere.partnerIds.has(a.site.partnerId)) ||
    (a.site?.customerId != null && elsewhere.customerIds.has(a.site.customerId))
  );
}

// ── Claude's read-through ─────────────────────────────────────────────────

const CLAUDE_SYSTEM = `You check the reports that security officers of a UK security company file after patrols, static-shift patrol rounds, callouts, lock-ups and unlocks. Each morning you read the last day's reports and tell the office manager what matters.

List ONLY real incidents or security issues the reports mention: break-ins or attempted entry, damage or vandalism, intruders, trespassers or suspicious people or vehicles, police / fire / ambulance called or attending, doors, gates or shutters found open or insecure, alarm faults, fire, smoke, floods or leaks, injuries, theft, people locked in, rough sleepers, and anything else the client would need to know. Ignore routine "all secure" reports and answers of "No". Never invent details or add anything the report doesn't say.

Severity: high = break-in, intruder on site, emergency services attended, injury, or a site left insecure; medium = damage, an alarm fault, suspicious activity, or something found open and then secured; low = minor things worth knowing.

The overview is 2–3 short, plain-English sentences: how the day went and what to look at first, using the counts given. No jargon.`;

type ClaudeIncidents = {
  overview: string;
  incidents: { ref: number; severity: "high" | "medium" | "low"; category: string; summary: string }[];
};

const CLAUDE_SCHEMA = {
  type: "object" as const,
  properties: {
    overview: { type: "string", description: "2–3 short sentences for the office manager." },
    incidents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ref: { type: "integer", description: "The report's number, e.g. 3 for [3]." },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: {
            type: "string",
            description:
              "Short label: Break-in, Damage, Intruder / suspicious, Emergency services, Insecure site, Alarm fault, Fire / water, Theft, Injury, Person locked in, or Other.",
          },
          summary: {
            type: "string",
            description: "One sentence, at most 25 words: what happened and what the officer did.",
          },
        },
        required: ["ref", "severity", "category", "summary"],
      },
    },
  },
  required: ["overview", "incidents"],
};

/** Reports Claude reads in one go; more than this and the newest are read. */
const CLAUDE_MAX_REPORTS = 200;

// ── Run ───────────────────────────────────────────────────────────────────

export type RunResult = {
  id: string;
  counts: DailyCheckCounts;
  emailed: { to: string[] } | { skipped: string };
};

export async function runDailyCheck(opts: {
  trigger: "cron" | "manual";
  email: boolean;
  now?: Date;
}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const { from, until, robotSeen } = await checkPeriod(now);
  const nearFrom = new Date(from.getTime() - 6 * HOUR);
  const nearUntil = new Date(until.getTime() + 6 * HOUR);

  const [nexus, keyholdingPartners, keyholding, formsOn, staff, lastNexus] = await Promise.all([
    prisma.partner.findUnique({ where: { name: NEXUS_PARTNER_NAME }, select: { id: true } }),
    prisma.partner.findMany({
      where: { name: { contains: "keyholding", mode: "insensitive" } },
      select: { id: true },
    }),
    resolveKeyholdingCustomer(prisma),
    prisma.fastFieldForm.count({ where: { mode: "ON" } }),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "DISPATCHER", "OFFICER"] } },
      select: { id: true, name: true, siaNumber: true },
    }),
    prisma.job.aggregate({
      where: { partnerActivityRef: { startsWith: "LINK-" } },
      _max: { updatedAt: true },
    }),
  ]);
  const keyholdingId = keyholding?.id ?? null;
  const elsewhere: ReportedElsewhere = {
    partnerIds: new Set([...(nexus ? [nexus.id] : []), ...keyholdingPartners.map((p) => p.id)]),
    customerIds: new Set(keyholdingId ? [keyholdingId] : []),
  };
  const lastKeyholding = keyholdingId
    ? await prisma.job.aggregate({
        where: { customerId: keyholdingId, partnerActivityRef: { not: null } },
        _max: { updatedAt: true },
      })
    : null;

  // Jobs and patrol visits around the period (wider, so a duplicate whose
  // other half is just outside still pairs up).
  const range = { gte: nearFrom, lte: nearUntil };
  const [jobs, visits, shifts] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        siteId: { not: null },
        type: { in: [...ACTIVITY_TYPES] },
        OR: [{ scheduledFor: range }, { startedAt: range }, { completedAt: range }],
      },
      select: {
        id: true,
        type: true,
        source: true,
        status: true,
        siteId: true,
        customerId: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        partnerActivityRef: true,
        recordedByUserId: true,
        reportedViaPartnerApp: true,
        handledByPartnerId: true,
        patrolVisitId: true,
        site: { select: { name: true, postcode: true, partnerId: true, customerId: true } },
        fastfieldReports: { where: { jobCreated: true }, select: { id: true }, take: 1 },
        _count: { select: { formSubmissions: true, fastfieldReports: true } },
      },
      take: 5000,
    }),
    prisma.patrolVisit.findMany({
      where: { status: { not: "CANCELLED" }, scheduledAt: range },
      select: {
        id: true,
        siteId: true,
        status: true,
        scheduledAt: true,
        arrivedAt: true,
        departedAt: true,
        reportedViaPartnerApp: true,
        handledByPartnerId: true,
        patrolScheduleId: true,
        patrolSchedule: { select: { kind: true } },
        site: { select: { name: true, postcode: true, partnerId: true, customerId: true } },
        _count: { select: { formSubmissions: true, fastfieldReports: true } },
      },
      take: 5000,
    }),
    prisma.shift.findMany({
      where: {
        scheduledStartsAt: { gte: from, lt: until },
        status: { in: ["IN_PROGRESS", "COMPLETED"] },
        handledByPartnerId: null,
      },
      select: {
        id: true,
        type: true,
        status: true,
        scheduledStartsAt: true,
        site: { select: { id: true, name: true, partnerId: true, customerId: true } },
        _count: { select: { fastfieldReports: true } },
        formSubmissions: { where: { form: "SHIFT_CHECK" }, select: { id: true }, take: 1 },
      },
      take: 1000,
    }),
  ]);

  const siteNames = new Map<string, string>();
  const acts: CheckActivity[] = [];
  const found = new Map<string, FoundActivity>();
  for (const j of jobs as JobRow[]) {
    if (!j.siteId) continue;
    siteNames.set(j.siteId, j.site?.name ?? "Unknown site");
    const times = present([j.scheduledFor, j.startedAt, j.completedAt]);
    const a: CheckActivity = {
      kind: "job",
      id: j.id,
      siteId: j.siteId,
      type: j.type,
      source: jobSource(j, keyholdingId),
      main: jobMain(j),
      times: times.length ? times : [j.createdAt],
      status: j.status,
      visitId: j.patrolVisitId,
    };
    acts.push(a);
    found.set(j.id, { kind: "job", id: j.id, type: j.type, source: a.source, at: a.main.toISOString(), status: j.status });
  }
  for (const v of visits) {
    siteNames.set(v.siteId, v.site.name);
    const type = v.patrolSchedule?.kind ?? "PATROL";
    const a: CheckActivity = {
      kind: "visit",
      id: v.id,
      siteId: v.siteId,
      type,
      source: v.patrolScheduleId ? "Our schedule" : "Patrol visit",
      main: v.arrivedAt ?? v.scheduledAt,
      times: present([v.scheduledAt, v.arrivedAt, v.departedAt]),
      status: v.status,
    };
    acts.push(a);
    found.set(v.id, { kind: "visit", id: v.id, type, source: a.source, at: a.main.toISOString(), status: v.status });
  }

  // 1. Possible duplicates with at least one half in the period. Site records
  //    that are one place (a partner import's copy of a site we set up) are
  //    compared as one, so the same job on both still shows.
  const sitePostcodes = new Map<string, string>();
  for (const j of jobs as JobRow[]) if (j.siteId && j.site) sitePostcodes.set(j.siteId, j.site.postcode);
  for (const v of visits) sitePostcodes.set(v.siteId, v.site.postcode);
  const places = samePlaceIds(
    Array.from(siteNames.entries()).map(([id, name]) => ({ id, name, postcode: sitePostcodes.get(id) ?? null })),
  );
  for (const a of acts) a.placeId = places.get(a.siteId);
  const duplicates: DuplicateFinding[] = findDuplicatePairs(acts)
    .filter(([a, b]) => inPeriod(a.main, from, until) || inPeriod(b.main, from, until))
    .slice(0, 100)
    .map(([a, b]) => ({
      siteId: a.siteId,
      siteName:
        a.siteId === b.siteId
          ? (siteNames.get(a.siteId) ?? "Unknown site")
          : `${siteNames.get(a.siteId) ?? "Unknown site"} / ${siteNames.get(b.siteId) ?? "Unknown site"} — one place on two site records`,
      items: [found.get(a.id)!, found.get(b.id)!],
    }));

  // 2. Our own activities with no report — only once FastField reports are
  //    being imported, else everything would show.
  const missing: MissingFinding[] = [];
  let missingSkipped: string | null = null;
  if (formsOn === 0) {
    missingSkipped =
      "No FastField form is switched On yet, so reports aren't expected in the app — missing reports weren't checked.";
  } else {
    for (const j of jobs as JobRow[]) {
      if (!j.siteId || j.patrolVisitId) continue;
      if (j._count.formSubmissions > 0 || j._count.fastfieldReports > 0) continue;
      if (!familyOf(j.type) || !inPeriod(jobMain(j), from, until)) continue;
      if (reportedElsewhere(j, elsewhere)) continue;
      missing.push({
        siteId: j.siteId,
        siteName: j.site?.name ?? "Unknown site",
        item: found.get(j.id)!,
        why: DONE_JOB.has(j.status) ? "Marked done, but no report." : "Still open, and no report.",
      });
    }
    for (const v of visits) {
      if (v._count.formSubmissions > 0 || v._count.fastfieldReports > 0) continue;
      if (!inPeriod(v.scheduledAt, from, until)) continue;
      if (reportedElsewhere(v, elsewhere)) continue;
      missing.push({
        siteId: v.siteId,
        siteName: v.site.name,
        item: found.get(v.id)!,
        why:
          v.status === "COMPLETED"
            ? "Marked done, but no report."
            : v.status === "MISSED"
              ? "Missed — no sign it was done."
              : "No report.",
      });
    }
    for (const s of shifts) {
      if (s._count.fastfieldReports > 0 || s.formSubmissions.length > 0) continue;
      if (reportedElsewhere({ reportedViaPartnerApp: false, handledByPartnerId: null, site: s.site }, elsewhere)) {
        continue;
      }
      missing.push({
        siteId: s.site.id,
        siteName: s.site.name,
        item: {
          kind: "shift",
          id: s.id,
          type: s.type === "DOG_HANDLER" ? "DOG_HANDLER_SHIFT" : "STATIC_GUARDING_SHIFT",
          source: "Our rota",
          at: s.scheduledStartsAt.toISOString(),
          status: s.status,
        },
        why: "No patrol reports or check-ins during the shift.",
      });
    }
    missing.sort((a, b) => a.item.at.localeCompare(b.item.at));
    missing.splice(100);
  }

  // 3–4. FastField reports that came in since the last morning check.
  const lastCron = await prisma.dailyCheck.findFirst({
    where: { trigger: "cron" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const reportsSince = lastCron?.createdAt ?? new Date(now.getTime() - 24 * HOUR);
  const [reports, unmatchedReports, allSites] = await Promise.all([
    prisma.fastFieldReport.findMany({
      where: { createdAt: { gt: reportsSince }, status: { not: "IGNORED" } },
      orderBy: { submittedAt: "desc" },
      take: 400,
      select: {
        id: true,
        submittedAt: true,
        startedAt: true,
        finishedAt: true,
        siteText: true,
        officerText: true,
        lat: true,
        lng: true,
        answers: true,
        patrolVisitId: true,
        shiftId: true,
        form: { select: { name: true, jobType: true, customerId: true } },
        site: {
          select: { id: true, name: true, postcode: true, lat: true, lng: true, geofenceRadiusM: true },
        },
        job: { select: { type: true } },
      },
    }),
    prisma.fastFieldReport.count({ where: { status: "UNMATCHED" } }),
    prisma.site.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true, postcode: true, addressLine: true, city: true, customerId: true },
    }),
  ]);
  const candidates = (customerId: string | null): SiteCandidate[] =>
    allSites
      .filter((s) => !customerId || s.customerId === customerId)
      .map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        postcode: s.postcode,
        address: [s.addressLine, s.city].filter(Boolean).join(" "),
      }));
  const nameIndex = new Map(allSites.map((s) => [s.id, s.name]));

  const issuesFound: ReportIssueFinding[] = [];
  const reportFacts = reports.map((r) => {
    const facts = extractFacts({
      submittedAt: r.submittedAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      answers: r.answers as unknown as FastFieldAnswer[],
    });
    return { r, facts };
  });
  for (const { r, facts } of reportFacts) {
    const siteText = r.siteText ?? facts.siteText;
    const nameOnly = siteText?.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, " ").trim();
    let nameFits: { ids: string[]; firstName: string | null } | null = null;
    if (nameOnly) {
      const m = matchSite(nameOnly, candidates(r.form.customerId));
      const ids = m.kind === "one" ? [m.site.id] : m.kind === "many" ? m.sites.map((s) => s.id) : [];
      nameFits = { ids, firstName: ids.length === 1 ? nameIndex.get(ids[0]) ?? null : null };
    }
    const issues = reportIssues({
      siteText,
      lat: r.lat ?? facts.lat,
      lng: r.lng ?? facts.lng,
      site: r.site,
      nameFits,
      reportKind: facts.visitType ?? r.form.jobType,
      linkedKind: r.job?.type ?? (r.patrolVisitId ? "PATROL" : r.shiftId ? "SHIFT" : null),
      officerText: facts.officerName ?? facts.officerText,
      officerKnown: !facts.officerText || pickOfficer(facts, staff) != null,
    });
    if (issues.length) {
      issuesFound.push({
        reportId: r.id,
        siteName: r.site?.name ?? siteText,
        form: r.form.name.trim(),
        at: facts.when.toISOString(),
        officer: facts.officerName ?? facts.officerText,
        issues,
      });
    }
  }

  // Incidents: Claude reads the reports; keywords if it can't.
  const counts0 = {
    duplicates: duplicates.length,
    missing: missing.length,
    reportIssues: issuesFound.length,
    unmatched: unmatchedReports,
  };
  const syncs: SyncFinding[] = [
    { name: "FastField", last: robotSeen },
    { name: "Nexus", last: lastNexus._max.updatedAt ?? null },
    { name: "Keyholding", last: lastKeyholding?._max.updatedAt ?? null },
  ].map((s) => ({
    name: s.name,
    lastSeen: s.last?.toISOString() ?? null,
    stale: s.last != null && now.getTime() - s.last.getTime() > 8 * HOUR,
  }));

  let incidents: IncidentFinding[] = [];
  let incidentsBy: "claude" | "keywords" = "keywords";
  let overview: string | null = null;
  let claudeNote: string | null = null;
  const toRead = reportFacts.slice(0, CLAUDE_MAX_REPORTS);
  if (!isAnthropicConfigured()) {
    claudeNote = "Claude isn't set up (no ANTHROPIC_API_KEY), so incidents were found by keyword.";
  } else {
    const blocks = toRead.map(({ r, facts }, i) => {
      const head = [
        `[${i + 1}]`,
        `Site: ${r.site?.name ?? facts.siteText ?? "not given"}`,
        `Form: ${r.form.name.trim()}`,
        formatDateTime(facts.when),
        facts.officerName ? `Officer: ${facts.officerName}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `${head}\n${reportText(r.answers as unknown as FastFieldAnswer[], 700)}`;
    });
    const staleNames = syncs.filter((s) => s.stale).map((s) => s.name);
    const userText =
      `Findings from the checks so far: ${counts0.duplicates} possible duplicate records, ` +
      `${counts0.missing} activities with no report, ${counts0.reportIssues} reports with problems ` +
      `(GPS, site name, form or officer), ${counts0.unmatched} reports waiting to be linked by hand` +
      (staleNames.length ? `, and these syncs haven't run lately: ${staleNames.join(", ")}` : "") +
      `.\n\n${reports.length} reports came in since the last check` +
      (reports.length > toRead.length ? ` (the newest ${toRead.length} are below)` : "") +
      `:\n\n${blocks.join("\n\n") || "(none)"}`;
    const res = await extractWithTool<ClaudeIncidents>({
      system: CLAUDE_SYSTEM,
      userText,
      toolName: "daily_check",
      toolDescription: "Record the incidents found in the reports and the overview for the office.",
      schema: CLAUDE_SCHEMA,
      maxTokens: 4000,
    });
    if (res.ok) {
      incidentsBy = "claude";
      overview = res.data.overview?.trim() || null;
      for (const inc of res.data.incidents ?? []) {
        const hit = toRead[inc.ref - 1];
        if (!hit) continue;
        incidents.push({
          reportId: hit.r.id,
          siteName: hit.r.site?.name ?? hit.facts.siteText,
          at: hit.facts.when.toISOString(),
          severity: inc.severity,
          category: String(inc.category).slice(0, 60),
          summary: String(inc.summary).slice(0, 300),
        });
      }
    } else {
      claudeNote = "Claude couldn't be reached, so incidents were found by keyword.";
      console.error("Daily check: Claude call failed:", res.error.slice(0, 120));
    }
  }
  if (incidentsBy === "keywords") {
    for (const { r, facts } of reportFacts) {
      for (const k of keywordIncidents(r.answers as unknown as FastFieldAnswer[])) {
        incidents.push({
          reportId: r.id,
          siteName: r.site?.name ?? facts.siteText,
          at: facts.when.toISOString(),
          severity: "medium",
          category: k.category,
          summary: k.summary,
        });
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  incidents = incidents.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at.localeCompare(a.at)).slice(0, 100);

  const findings: DailyCheckFindings = {
    period: { from: from.toISOString(), until: until.toISOString() },
    duplicates,
    missing,
    missingSkipped,
    reportIssues: issuesFound.slice(0, 100),
    unmatchedReports,
    incidents,
    incidentsBy,
    claudeNote,
    reportsRead: reports.length,
    syncs,
  };
  const staleSyncs = syncs.filter((s) => s.stale).length;
  const counts: DailyCheckCounts = {
    duplicates: duplicates.length,
    missing: missing.length,
    reportIssues: findings.reportIssues.length,
    unmatched: unmatchedReports,
    incidents: incidents.length,
    staleSyncs,
    total: duplicates.length + missing.length + findings.reportIssues.length + incidents.length + staleSyncs,
  };

  const row = await prisma.dailyCheck.create({
    data: {
      periodStart: from,
      periodEnd: until,
      findings: findings as unknown as Prisma.InputJsonValue,
      counts: counts as unknown as Prisma.InputJsonValue,
      overview,
      trigger: opts.trigger,
    },
    select: { id: true },
  });

  let emailed: RunResult["emailed"] = { skipped: "not requested" };
  if (opts.email) {
    const settings = await getDailyCheckSettings();
    const to = recipientsFrom(settings.recipients);
    if (!settings.enabled) emailed = { skipped: "switched off" };
    else if (!to.length) emailed = { skipped: "no recipient" };
    else if (!isEmailConfigured()) emailed = { skipped: "email isn't set up" };
    else {
      const mail = dailyCheckEmail(row.id, findings, counts, overview);
      const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
      if (sent.ok) {
        await prisma.dailyCheck.update({
          where: { id: row.id },
          data: { emailedTo: to.join(", "), emailedAt: new Date() },
        });
        emailed = { to };
      } else {
        emailed = { skipped: "the email didn't send" };
        console.error("Daily check: email failed");
      }
    }
  }
  return { id: row.id, counts, emailed };
}

// ── The email ─────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function activityHref(a: { kind: string; id: string }): string {
  if (a.kind === "job") return `/dispatch/${a.id}`;
  if (a.kind === "visit") return `/patrols/visits/${a.id}`;
  if (a.kind === "shift") return `/shifts/${a.id}`;
  return `/admin/fastfield/${a.id}`;
}

const TYPE_WORD: Record<string, string> = {
  ALARM_RESPONSE: "Callout",
  ADHOC: "Ad-hoc job",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  PATROL: "Patrol",
  VPI: "VPI",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  STATIC_GUARDING_SHIFT: "Static shift",
  DOG_HANDLER_SHIFT: "Dog-handler shift",
};
export const typeWord = (t: string) => TYPE_WORD[t] ?? t.replace(/_/g, " ").toLowerCase();

export function describeActivity(a: FoundActivity): string {
  return `${typeWord(a.type)} · ${a.source} · ${formatDateTime(a.at)} · ${a.status.replace(/_/g, " ").toLowerCase()}`;
}

function periodLabel(f: DailyCheckFindings): string {
  return `${formatDateTime(f.period.from)} to ${formatDateTime(f.period.until)}`;
}

export function dailyCheckEmail(
  id: string,
  f: DailyCheckFindings,
  c: DailyCheckCounts,
  overview: string | null,
): { subject: string; html: string; text: string } {
  const base = (process.env.NEXTAUTH_URL || "https://1st-nationwide-ops.vercel.app").replace(/\/+$/, "");
  const link = (path: string, label: string) => `<a href="${esc(base + path)}">${esc(label)}</a>`;
  const subject = `Daily check — ${c.total ? `${c.total} to look at` : "all clear"} (${periodLabel(f)})`;
  const parts: string[] = [];
  const lines: string[] = [];
  parts.push(`<p style="margin:0 0 12px">${esc(overview ?? (c.total ? "Here's what needs a look." : "Nothing needs a look."))}</p>`);
  lines.push(overview ?? (c.total ? "Here's what needs a look." : "Nothing needs a look."), "");

  const section = (title: string, items: string[], textItems: string[]) => {
    if (!items.length) return;
    parts.push(`<h3 style="margin:16px 0 6px;font-size:15px">${esc(title)}</h3><ul style="margin:0;padding-left:18px">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join("")}</ul>`);
    lines.push(title, ...textItems.map((t) => `- ${t}`), "");
  };

  section(
    `Incidents (${f.incidents.length})`,
    f.incidents.slice(0, 25).map(
      (i) =>
        `<b>${esc(i.severity.toUpperCase())}</b> · ${esc(i.category)} · ${esc(i.siteName ?? "Unknown site")}, ${esc(formatDateTime(i.at))}: ${esc(i.summary)} ${link(`/admin/fastfield/${i.reportId}`, "report")}`,
    ),
    f.incidents.slice(0, 25).map((i) => `${i.severity.toUpperCase()} ${i.category} — ${i.siteName ?? "Unknown site"}: ${i.summary}`),
  );
  section(
    `Possible duplicates (${f.duplicates.length})`,
    f.duplicates.slice(0, 25).map(
      (d) =>
        `${esc(d.siteName)}: ${d.items.map((a) => link(activityHref(a), describeActivity(a))).join(" and ")}`,
    ),
    f.duplicates.slice(0, 25).map((d) => `${d.siteName}: ${d.items.map(describeActivity).join(" AND ")}`),
  );
  section(
    `Missing reports (${f.missing.length})`,
    f.missing.slice(0, 25).map(
      (m) => `${esc(m.siteName)}: ${link(activityHref(m.item), describeActivity(m.item))} — ${esc(m.why)}`,
    ),
    f.missing.slice(0, 25).map((m) => `${m.siteName}: ${describeActivity(m.item)} — ${m.why}`),
  );
  section(
    `Report problems (${f.reportIssues.length})`,
    f.reportIssues.slice(0, 25).map(
      (r) =>
        `${link(`/admin/fastfield/${r.reportId}`, `${r.siteName ?? "Unknown site"}, ${formatDateTime(r.at)}`)} (${esc(r.form)}): ${esc(r.issues.join(" "))}`,
    ),
    f.reportIssues.slice(0, 25).map((r) => `${r.siteName ?? "Unknown site"} (${r.form}): ${r.issues.join(" ")}`),
  );
  const stale = f.syncs.filter((s) => s.stale);
  section(
    "Syncs that haven't run lately",
    stale.map((s) => `${esc(s.name)}: last ${s.lastSeen ? esc(formatDateTime(s.lastSeen)) : "never"}`),
    stale.map((s) => `${s.name}: last ${s.lastSeen ? formatDateTime(s.lastSeen) : "never"}`),
  );
  if (f.unmatchedReports) {
    const waiting = `${f.unmatchedReports} FastField report${f.unmatchedReports === 1 ? " is" : "s are"} waiting to be linked by hand`;
    parts.push(`<p style="margin:16px 0 0">${esc(`${waiting}:`)} ${link("/admin/fastfield", "open FastField")}.</p>`);
    lines.push(`${waiting}.`);
  }
  if (f.missingSkipped) {
    parts.push(`<p style="margin:12px 0 0;color:#64748b">${esc(f.missingSkipped)}</p>`);
  }
  if (f.claudeNote) {
    parts.push(`<p style="margin:12px 0 0;color:#64748b">${esc(f.claudeNote)}</p>`);
  }
  parts.push(`<p style="margin:16px 0 0">${link(`/admin/daily-check?id=${id}`, "Open the full check")}</p>`);
  lines.push(`Full check: ${base}/admin/daily-check?id=${id}`);

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f1929;line-height:1.45;max-width:680px">
<p style="margin:0 0 4px;color:#64748b">Daily check · ${esc(periodLabel(f))} · ${f.reportsRead} FastField reports read</p>
${parts.join("\n")}
</div>`;
  return { subject, html, text: lines.join("\n") };
}
