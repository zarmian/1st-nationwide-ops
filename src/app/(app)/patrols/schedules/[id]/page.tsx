import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const DAY_LABEL: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

const FREQ_LABEL: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
};

function fmtFull(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const VISIT_STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-amber",
  LATE: "chip-amber",
  COMPLETED: "chip-mint",
  MISSED: "chip-red",
};

export default async function PatrolScheduleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireStaff();

  const schedule = await prisma.patrolSchedule.findUnique({
    where: { id: params.id },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          addressLine: true,
          postcodeFormatted: true,
          region: { select: { name: true } },
        },
      },
      assignedOfficer: { select: { id: true, name: true } },
      visits: {
        select: {
          id: true,
          scheduledAt: true,
          arrivedAt: true,
          departedAt: true,
          status: true,
          officer: { select: { name: true } },
        },
        orderBy: { scheduledAt: "desc" },
        take: 30,
      },
    },
  });
  if (!schedule) notFound();

  const editAnchor =
    schedule.kind === "VPI" ? "vpi-section" : "patrol-section";

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title={`${schedule.kind === "VPI" ? "VPI" : "Patrol"} schedule${schedule.site ? ` @ ${schedule.site.name}` : ""}`}
        backHref="/patrols"
        backLabel="Patrols"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="chip-slate">
              {DAY_LABEL[schedule.dayOfWeek] ?? schedule.dayOfWeek}
            </span>
            <span className="chip-slate">
              {FREQ_LABEL[schedule.frequency] ?? schedule.frequency}
            </span>
            {schedule.active ? (
              <span className="chip-mint">Active</span>
            ) : (
              <span className="chip-red">Paused</span>
            )}
          </span>
        }
        actions={
          <Link
            href={`/sites/${schedule.site.id}/edit#${editAnchor}`}
            className="btn-secondary text-sm"
          >
            Edit on site →
          </Link>
        }
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Site
          </h2>
          <Link
            href={`/sites/${schedule.site.id}/edit`}
            className="font-medium text-brand-navy hover:text-brand-blue-dark text-base"
          >
            {schedule.site.name} →
          </Link>
          <div className="text-sm text-slate-600">
            {schedule.site.addressLine}
          </div>
          <div className="text-sm font-mono text-slate-500">
            {schedule.site.postcodeFormatted}
            {schedule.site.region
              ? ` · ${schedule.site.region.name}`
              : ""}
          </div>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Assigned officer
          </h2>
          {schedule.assignedOfficer ? (
            <Link
              href={`/officers/${schedule.assignedOfficer.id}/edit`}
              className="font-medium text-brand-navy hover:text-brand-blue-dark"
            >
              {schedule.assignedOfficer.name} →
            </Link>
          ) : (
            <span className="text-slate-400 italic">Unassigned</span>
          )}
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Window
          </h2>
          <dl className="text-sm space-y-1">
            <Row label="Starts on">{fmtDate(schedule.startsOn)}</Row>
            <Row label="Ends on">{fmtDate(schedule.endsOn)}</Row>
          </dl>
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          Recent visits ({schedule.visits.length})
        </h2>
        {schedule.visits.length === 0 ? (
          <p className="text-sm text-slate-400 italic">
            No visits generated yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {schedule.visits.map((v) => (
              <li
                key={v.id}
                className="flex items-baseline justify-between gap-2 py-2"
              >
                <Link
                  href={`/patrols/visits/${v.id}`}
                  className="text-sm text-brand-navy hover:text-brand-blue-dark"
                >
                  {fmtFull(v.scheduledAt)}
                  {v.officer ? ` · ${v.officer.name}` : " · Unassigned"}
                  {" →"}
                </Link>
                <span className={VISIT_STATUS_TONE[v.status] ?? "chip-slate"}>
                  {v.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500 w-28 shrink-0">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
