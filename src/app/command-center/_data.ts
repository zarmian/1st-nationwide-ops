import { prisma } from "@/lib/db";
import { daysFromTodayUk } from "@/lib/dates";

/**
 * Shared live-data helpers for the Command Center pages. Everything here is
 * read-only and derives directly from Prisma so the pages stay thin. The
 * merged "board" mirrors the real /dispatch page: Jobs and PatrolVisits are
 * one list to the user ("every activity is a job").
 */

export const LIVE_JOB_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS"] as const;
export const LIVE_VISIT_STATUSES = ["PENDING", "IN_PROGRESS", "LATE"] as const;

export const TYPE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collect",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static guard",
  DOG_HANDLER_SHIFT: "Dog handler",
};

type Tone = "blue" | "green" | "amber" | "red" | "slate";

export type StatusView = { tone: Tone; label: string; icon: string };

export function jobStatusView(status: string, viaPartnerApp: boolean): StatusView {
  if (viaPartnerApp && (status === "SUBMITTED" || status === "APPROVED" || status === "SENT_TO_CLIENT" || status === "CLOSED"))
    return { tone: "slate", label: "Logged · no report", icon: "fileOff" };
  switch (status) {
    case "OPEN":
    case "ASSIGNED":
      return { tone: "slate", label: "Pending", icon: "minus" };
    case "IN_PROGRESS":
      return { tone: "blue", label: "In progress", icon: "activity" };
    case "SUBMITTED":
      return { tone: "amber", label: "Submitted", icon: "inbox" };
    case "REVIEW_PENDING":
      return { tone: "amber", label: "Awaiting review", icon: "clock" };
    case "APPROVED":
      return { tone: "green", label: "Approved", icon: "check" };
    case "SENT_TO_CLIENT":
      return { tone: "green", label: "Sent to client", icon: "send" };
    case "CLOSED":
      return { tone: "slate", label: "Closed", icon: "check" };
    case "CANCELLED":
      return { tone: "red", label: "Cancelled", icon: "x" };
    default:
      return { tone: "slate", label: status, icon: "minus" };
  }
}

export function visitStatusView(status: string): StatusView {
  switch (status) {
    case "PENDING":
      return { tone: "slate", label: "Pending", icon: "minus" };
    case "IN_PROGRESS":
      return { tone: "blue", label: "In progress", icon: "activity" };
    case "LATE":
      return { tone: "amber", label: "Late", icon: "clock" };
    case "COMPLETED":
      return { tone: "green", label: "Completed", icon: "check" };
    case "MISSED":
      return { tone: "red", label: "Missed", icon: "alert" };
    case "CANCELLED":
      return { tone: "red", label: "Cancelled", icon: "x" };
    default:
      return { tone: "slate", label: status, icon: "minus" };
  }
}

export type SourceKind = "direct" | "app" | "subbed" | "none";

export type BoardRow = {
  id: string;
  kind: "job" | "visit";
  typeRaw: string;
  typeLabel: string;
  status: StatusView;
  sourceKind: SourceKind;
  ownerName: string;
  responder: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  scheduledFor: Date | null;
  siteName: string;
  siteSub: string;
};

export function priorityRank(p: string): number {
  return p === "HIGH" ? 0 : p === "MEDIUM" ? 1 : 2;
}

/** "Today · 14:21", "Tomorrow · 09:00", "Mon 19 May · 14:30", or null. */
export function formatSched(date: Date | null | undefined): { day: string; time: string } | null {
  if (!date) return null;
  const diff = daysFromTodayUk(date);
  const time = date.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  let day: string;
  if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else day = date.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short" });
  return { day, time };
}

export function relativeTimeUk(date: Date | null): string {
  if (!date) return "—";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short" });
}

type OwnerRels = {
  reportedViaPartnerApp: boolean;
  customer: { name: string } | null;
  partner: { name: string } | null;
  handledByPartner: { name: string } | null;
};

/** Classify which of the three relationship modes a row belongs to. */
function classifySource(r: OwnerRels): { sourceKind: SourceKind; ownerName: string } {
  if (r.reportedViaPartnerApp) {
    return { sourceKind: "app", ownerName: r.partner?.name ?? r.handledByPartner?.name ?? "Partner app" };
  }
  if (r.handledByPartner) {
    return { sourceKind: "subbed", ownerName: r.handledByPartner.name };
  }
  if (r.customer) return { sourceKind: "direct", ownerName: r.customer.name };
  if (r.partner) return { sourceKind: "app", ownerName: r.partner.name };
  return { sourceKind: "none", ownerName: "—" };
}

function siteSubtitle(site: { postcodeFormatted: string; region: { name: string } | null } | null): string {
  if (!site) return "—";
  const bits = [site.postcodeFormatted, site.region?.name].filter(Boolean);
  return bits.join(" · ") || "—";
}

export async function getLiveBoard(limit: number): Promise<BoardRow[]> {
  const [jobs, visits] = await Promise.all([
    prisma.job.findMany({
      where: { status: { in: [...LIVE_JOB_STATUSES] } },
      select: {
        id: true,
        type: true,
        typeLabel: true,
        status: true,
        priority: true,
        scheduledFor: true,
        reportedViaPartnerApp: true,
        externalResponder: true,
        site: { select: { name: true, postcodeFormatted: true, region: { select: { name: true } } } },
        customer: { select: { name: true } },
        partner: { select: { name: true } },
        handledByPartner: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
      take: limit,
    }),
    prisma.patrolVisit.findMany({
      where: { status: { in: [...LIVE_VISIT_STATUSES] } },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        reportedViaPartnerApp: true,
        patrolSchedule: { select: { kind: true } },
        officer: { select: { name: true } },
        handledByPartner: { select: { name: true } },
        site: {
          select: {
            name: true,
            postcodeFormatted: true,
            region: { select: { name: true } },
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        },
      },
      orderBy: [{ scheduledAt: "asc" }],
      take: limit,
    }),
  ]);

  const jobRows: BoardRow[] = jobs.map((j) => {
    const src = classifySource({
      reportedViaPartnerApp: j.reportedViaPartnerApp,
      customer: j.customer,
      partner: j.partner,
      handledByPartner: j.handledByPartner,
    });
    const responder =
      j.assignedTo?.name ??
      (j.handledByPartner ? `${j.handledByPartner.name} officer` : null) ??
      j.externalResponder ??
      "Unassigned";
    return {
      id: j.id,
      kind: "job",
      typeRaw: j.type,
      typeLabel: j.typeLabel ?? TYPE_LABEL[j.type] ?? j.type,
      status: jobStatusView(j.status, j.reportedViaPartnerApp),
      sourceKind: src.sourceKind,
      ownerName: src.ownerName,
      responder,
      priority: j.priority as BoardRow["priority"],
      scheduledFor: j.scheduledFor,
      siteName: j.site?.name ?? "—",
      siteSub: siteSubtitle(j.site),
    };
  });

  const visitRows: BoardRow[] = visits.map((v) => {
    const src = classifySource({
      reportedViaPartnerApp: v.reportedViaPartnerApp,
      customer: v.site?.customer ?? null,
      partner: v.site?.partner ?? null,
      handledByPartner: v.handledByPartner,
    });
    return {
      id: v.id,
      kind: "visit",
      typeRaw: v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL",
      typeLabel: v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol",
      status: visitStatusView(v.status),
      sourceKind: src.sourceKind,
      ownerName: src.ownerName,
      responder: v.officer?.name ?? (v.handledByPartner ? `${v.handledByPartner.name} officer` : "Unassigned"),
      priority: "MEDIUM",
      scheduledFor: v.scheduledAt,
      siteName: v.site?.name ?? "—",
      siteSub: siteSubtitle(v.site ?? null),
    };
  });

  return [...jobRows, ...visitRows]
    .sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      const at = a.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY;
      return at - bt;
    })
    .slice(0, limit);
}

export type OfficerRow = {
  id: string;
  name: string;
  roleLabel: string;
  freshness: "fresh" | "stale" | "old";
  lastSeen: string;
};

export async function getOnDuty(): Promise<OfficerRow[]> {
  const officers = await prisma.user.findMany({
    where: { active: true, onDuty: true, role: { in: ["OFFICER", "DISPATCHER"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true, lastSeenAt: true },
  });
  return officers.map((o) => {
    const mins = o.lastSeenAt ? (Date.now() - o.lastSeenAt.getTime()) / 60000 : Infinity;
    const freshness: OfficerRow["freshness"] = mins < 5 ? "fresh" : mins < 15 ? "stale" : "old";
    return {
      id: o.id,
      name: o.name,
      roleLabel: o.role === "DISPATCHER" ? "Dispatcher" : "Officer",
      freshness,
      lastSeen: relativeTimeUk(o.lastSeenAt),
    };
  });
}

export type BucketCounts = {
  pending: number;
  in_progress: number;
  review: number;
  missed: number;
  completed: number;
  cancelled: number;
  live: number;
};

export async function getBucketCounts(now: Date): Promise<BucketCounts> {
  const [
    jPending,
    jInProg,
    jReview,
    jMissed,
    jCompleted,
    jCancelled,
    vPending,
    vInProg,
    vMissed,
    vCompleted,
  ] = await prisma.$transaction([
    prisma.job.count({ where: { status: { in: ["OPEN", "ASSIGNED"] } } }),
    prisma.job.count({ where: { status: "IN_PROGRESS" } }),
    prisma.job.count({ where: { status: { in: ["SUBMITTED", "REVIEW_PENDING"] } } }),
    prisma.job.count({ where: { status: { in: ["OPEN", "ASSIGNED"] }, scheduledFor: { lt: now } } }),
    prisma.job.count({ where: { status: { in: ["APPROVED", "SENT_TO_CLIENT", "CLOSED"] } } }),
    prisma.job.count({ where: { status: "CANCELLED" } }),
    prisma.patrolVisit.count({ where: { status: "PENDING" } }),
    prisma.patrolVisit.count({ where: { status: { in: ["IN_PROGRESS", "LATE"] } } }),
    prisma.patrolVisit.count({ where: { OR: [{ status: "MISSED" }, { status: "PENDING", scheduledAt: { lt: now } }] } }),
    prisma.patrolVisit.count({ where: { status: "COMPLETED" } }),
  ]);
  const pending = jPending + vPending;
  const in_progress = jInProg + vInProg;
  const missed = jMissed + vMissed;
  const completed = jCompleted + vCompleted;
  return {
    pending,
    in_progress,
    review: jReview,
    missed,
    completed,
    cancelled: jCancelled,
    live: pending + in_progress,
  };
}
