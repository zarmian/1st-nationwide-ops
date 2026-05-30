import { prisma } from "@/lib/db";

export type ActivityEvent = {
  id: string;
  kind: "ALARM" | "PATROL" | "SUBMISSION" | "JOB";
  severity: "ok" | "info" | "warn" | "danger";
  at: Date;
  title: string;
  detail: string | null;
  actor: string | null;
  href: string | null;
};

export async function loadActivity(
  siteId: string,
  opts: { take?: number; skip?: number } = {},
) {
  const take = opts.take ?? 5;
  const skip = opts.skip ?? 0;
  // Pull a generous window from each source then merge & slice. For a site
  // with thousands of events we'll later move this to a unified view.
  const fanout = take + skip + 20;

  const [
    alarms,
    patrols,
    submissions,
    jobs,
    totalAlarms,
    totalPatrols,
    totalSubs,
    totalJobs,
  ] = await Promise.all([
    prisma.alarmEvent.findMany({
      where: { siteId },
      orderBy: { receivedAt: "desc" },
      take: fanout,
      include: {
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.patrolVisit.findMany({
      where: { siteId },
      orderBy: { scheduledAt: "desc" },
      take: fanout,
      include: {
        officer: { select: { name: true } },
        patrolSchedule: { select: { frequency: true, kind: true } },
      },
    }),
    prisma.formSubmission.findMany({
      where: { siteId },
      orderBy: { submittedAt: "desc" },
      take: fanout,
      include: {
        submittedBy: { select: { name: true } },
        review: { select: { id: true, status: true } },
      },
    }),
    prisma.job.findMany({
      where: { siteId },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: fanout,
      include: {
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.alarmEvent.count({ where: { siteId } }),
    prisma.patrolVisit.count({ where: { siteId } }),
    prisma.formSubmission.count({ where: { siteId } }),
    prisma.job.count({ where: { siteId } }),
  ]);

  const events: ActivityEvent[] = [
    ...alarms.map<ActivityEvent>((a) => ({
      id: `alarm:${a.id}`,
      kind: "ALARM",
      severity:
        a.outcome === "GENUINE" || a.outcome === "ESCALATED_TO_POLICE"
          ? "danger"
          : a.outcome === "FALSE_ALARM"
            ? "warn"
            : a.outcome === "RESOLVED"
              ? "ok"
              : "info",
      at: a.receivedAt,
      title: `Alarm response · ${prettyAlarmSource(a.source)}${
        a.outcome ? ` · ${prettyAlarmOutcome(a.outcome)}` : ""
      }`,
      detail:
        a.notes ?? a.rawSubject ?? (a.zone ? `Zone ${a.zone}` : null),
      actor: a.assignedTo?.name ?? null,
      href: `/alarms/${a.id}`,
    })),
    ...patrols.map<ActivityEvent>((p) => {
      const onSite =
        p.arrivedAt && p.departedAt
          ? Math.round(
              (p.departedAt.getTime() - p.arrivedAt.getTime()) / 60000,
            )
          : null;
      const kindLabel =
        p.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol";
      const freq = p.patrolSchedule?.frequency
        ? ` — ${p.patrolSchedule.frequency.toLowerCase()}`
        : "";
      return {
        id: `patrol:${p.id}`,
        kind: "PATROL",
        severity:
          p.status === "MISSED"
            ? "danger"
            : p.status === "COMPLETED"
              ? "info"
              : p.status === "IN_PROGRESS"
                ? "info"
                : "info",
        at: p.scheduledAt,
        title: `${kindLabel}${freq} · ${p.officer?.name ?? "Unassigned"}${
          onSite !== null ? ` · ${onSite} min on site` : ""
        }`,
        detail: p.notes,
        actor: p.officer?.name ?? null,
        href: `/patrols/visits/${p.id}`,
      };
    }),
    ...submissions.map<ActivityEvent>((s) => ({
      id: `sub:${s.id}`,
      kind: "SUBMISSION",
      severity: submissionSeverity(s.form),
      at: s.submittedAt,
      title: `${prettySubmissionForm(s.form)}${
        s.officerNameRaw ? ` · ${s.officerNameRaw}` : ""
      }`,
      detail: extractDetail(s.payload),
      actor: s.submittedBy?.name ?? s.officerNameRaw,
      // If there's a review row, open the review page (admin's submission
      // detail). Otherwise fall back to the parent job, which always exists
      // for cron-created jobs but not for ad-hoc /submit submissions.
      href: s.review?.id ? `/admin/reports/${s.review.id}` : null,
    })),
    ...jobs.map<ActivityEvent>((j) => ({
      id: `job:${j.id}`,
      kind: "JOB",
      severity:
        j.status === "CANCELLED"
          ? "warn"
          : j.status === "CLOSED" ||
              j.status === "SENT_TO_CLIENT" ||
              j.status === "APPROVED"
            ? "ok"
            : "info",
      at: j.completedAt ?? j.scheduledFor ?? j.createdAt,
      title: `${prettyJobType(j.type)} · ${j.status
        .replace(/_/g, " ")
        .toLowerCase()}${j.assignedTo ? ` · ${j.assignedTo.name}` : ""}`,
      detail: j.notes,
      actor: j.assignedTo?.name ?? null,
      href: `/dispatch/${j.id}`,
    })),
  ];

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  const total = totalAlarms + totalPatrols + totalSubs + totalJobs;
  return {
    events: events.slice(skip, skip + take),
    total,
  };
}

function prettyAlarmSource(s: string) {
  return s.replace(/_/g, " ").toLowerCase();
}

function prettyAlarmOutcome(o: string) {
  return o.replace(/_/g, " ").toLowerCase();
}

function prettySubmissionForm(f: string) {
  switch (f) {
    case "LOCK":
      return "Lockdown completed";
    case "UNLOCK":
      return "Unlock completed";
    case "PATROL":
      return "Patrol — submitted";
    case "ALARM_RESPONSE":
      return "Alarm response";
    case "VPI":
      return "VPI inspection";
    case "KEY_COLLECTION":
      return "Key collected";
    case "KEY_DROPOFF":
      return "Key dropped off";
    case "ADHOC":
      return "Ad-hoc visit";
    default:
      return f.replace(/_/g, " ").toLowerCase();
  }
}

function prettyJobType(t: string) {
  return t.replace(/_/g, " ").toLowerCase();
}

function submissionSeverity(f: string): ActivityEvent["severity"] {
  if (f === "ALARM_RESPONSE") return "warn";
  if (f === "LOCK" || f === "UNLOCK") return "ok";
  return "info";
}

function extractDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  for (const key of ["summary", "notes", "outcome", "comment"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
