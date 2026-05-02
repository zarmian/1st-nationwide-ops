import { prisma } from "@/lib/db";

export type ActivityEvent = {
  id: string;
  kind: "ALARM" | "PATROL" | "SUBMISSION";
  severity: "ok" | "info" | "warn" | "danger";
  at: Date;
  title: string;
  detail: string | null;
  actor: string | null;
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

  const [alarms, patrols, submissions, totalAlarms, totalPatrols, totalSubs] =
    await Promise.all([
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
        },
      }),
      prisma.alarmEvent.count({ where: { siteId } }),
      prisma.patrolVisit.count({ where: { siteId } }),
      prisma.formSubmission.count({ where: { siteId } }),
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
    })),
  ];

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  const total = totalAlarms + totalPatrols + totalSubs;
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
