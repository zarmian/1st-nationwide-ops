import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePartnerOfficer } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

function fmtFull(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Partner-officer "Today" — every activity assigned to them across
 * the next ~7 days. Pre-scheduled jobs the partner-admin queued are
 * the main thing here, but partner-recorded shifts that span a
 * future date also surface so the officer can confirm them after
 * the fact.
 *
 * "Done" rows (job with completedAt set, or shift past actualEndedAt)
 * are visually muted but still listed so the officer can review what
 * they did and edit times if needed.
 */
export default async function PartnerOfficerTodayPage() {
  const me = await requirePartnerOfficer();

  const now = new Date();
  const horizonStart = new Date(now);
  horizonStart.setDate(horizonStart.getDate() - 1); // include yesterday
  horizonStart.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(now);
  horizonEnd.setDate(horizonEnd.getDate() + 7);
  horizonEnd.setHours(23, 59, 59, 999);

  const [jobs, shifts] = await Promise.all([
    prisma.job.findMany({
      where: {
        handledByPartnerOfficerId: me.partnerOfficerId,
        status: { not: "CANCELLED" },
        OR: [
          { scheduledFor: { gte: horizonStart, lte: horizonEnd } },
          { completedAt: { gte: horizonStart, lte: horizonEnd } },
        ],
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        status: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        notes: true,
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            postcodeFormatted: true,
            addressLine: true,
          },
        },
        customer: { select: { name: true } },
      },
      take: 200,
    }),
    prisma.shift.findMany({
      where: {
        handledByPartnerOfficerId: me.partnerOfficerId,
        scheduledStartsAt: { gte: horizonStart, lte: horizonEnd },
      },
      orderBy: { scheduledStartsAt: "asc" },
      select: {
        id: true,
        type: true,
        status: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        actualStartedAt: true,
        actualEndedAt: true,
        notes: true,
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            postcodeFormatted: true,
            addressLine: true,
            customer: { select: { name: true } },
          },
        },
      },
      take: 200,
    }),
  ]);

  type Row = {
    encodedId: string;
    kind: "JOB" | "SHIFT";
    kindLabel: string;
    when: Date;
    whenLabel: string;
    isDone: boolean;
    siteName: string | null;
    siteCode: string | null;
    siteAddress: string | null;
    customerName: string | null;
  };
  const rows: Row[] = [];

  for (const j of jobs) {
    const when = j.scheduledFor ?? j.completedAt ?? j.startedAt ?? new Date();
    rows.push({
      encodedId: j.id,
      kind: "JOB",
      kindLabel: KIND_LABEL[j.type] ?? j.type.replace(/_/g, " "),
      when,
      whenLabel: fmtFull(j.scheduledFor) || fmtFull(j.completedAt),
      isDone: !!j.completedAt,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      siteAddress: j.site
        ? `${j.site.addressLine ?? ""}${j.site.postcodeFormatted ? ` · ${j.site.postcodeFormatted}` : ""}`.trim() || null
        : null,
      customerName: j.customer?.name ?? null,
    });
  }
  for (const s of shifts) {
    const when = s.actualStartedAt ?? s.scheduledStartsAt;
    rows.push({
      encodedId: `shift-${s.id}`,
      kind: "SHIFT",
      kindLabel: KIND_LABEL[s.type] ?? s.type,
      when,
      whenLabel: `${fmtFull(s.scheduledStartsAt)} → ${fmtTime(s.scheduledEndsAt)}`,
      isDone: !!s.actualEndedAt,
      siteName: s.site?.name ?? null,
      siteCode: s.site?.code ?? null,
      siteAddress: s.site
        ? `${s.site.addressLine ?? ""}${s.site.postcodeFormatted ? ` · ${s.site.postcodeFormatted}` : ""}`.trim() || null
        : null,
      customerName: s.site?.customer?.name ?? null,
    });
  }

  rows.sort((a, b) => {
    // Open work first, then done work; both sorted by scheduled time
    // ascending (next thing on top).
    if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
    return a.when.getTime() - b.when.getTime();
  });

  const openCount = rows.filter((r) => !r.isDone).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Today"
        subtitle={
          openCount > 0
            ? `${openCount} ${openCount === 1 ? "activity" : "activities"} waiting · ${rows.length - openCount} done`
            : rows.length > 0
              ? `${rows.length} done · nothing pending`
              : "Nothing assigned to you in the next 7 days."
        }
      />

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No assigned activities.</p>
          <p className="empty-blurb">
            Your partner-admin will assign jobs or shifts to you — they'll
            appear here as soon as they do.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.encodedId}>
              <Link
                href={`/partner/m/activities/${r.encodedId}`}
                className={
                  "card-hover block p-4 " +
                  (r.isDone ? "opacity-60" : "")
                }
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="chip-slate text-[10px]">{r.kindLabel}</span>
                    {r.isDone && (
                      <span className="chip-mint text-[10px]">Done</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {r.whenLabel}
                  </span>
                </div>
                <div className="font-medium text-brand-navy">
                  {r.siteCode ? `${r.siteCode} · ` : ""}
                  {r.siteName ?? "—"}
                </div>
                {r.siteAddress && (
                  <div className="text-xs text-slate-500">{r.siteAddress}</div>
                )}
                {r.customerName && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    Customer: {r.customerName}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
