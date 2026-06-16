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

const JOB_STATUS_TONE: Record<string, string> = {
  OPEN: "chip-slate",
  ASSIGNED: "chip-amber",
  IN_PROGRESS: "chip-amber",
  SUBMITTED: "chip-amber",
  REVIEW_PENDING: "chip-amber",
  APPROVED: "chip-mint",
  SENT_TO_CLIENT: "chip-mint",
  CLOSED: "chip-mint",
  CANCELLED: "chip-red",
};

export default async function LockUnlockScheduleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireStaff();

  const schedule = await prisma.lockUnlockSchedule.findUnique({
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
    },
  });
  if (!schedule) notFound();

  // Recent LOCK/UNLOCK jobs at this site — these are created by the cron
  // from the schedule but the link isn't on the Job model itself, so match
  // by siteId + type.
  const recentJobs = await prisma.job.findMany({
    where: {
      siteId: schedule.siteId,
      type: { in: ["LOCK", "UNLOCK"] },
    },
    select: {
      id: true,
      type: true,
      status: true,
      scheduledFor: true,
      completedAt: true,
      assignedTo: { select: { name: true } },
      handledByPartner: { select: { name: true } },
    },
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 30,
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title={`Lock-up / unlock schedule${schedule.site ? ` @ ${schedule.site.name}` : ""}`}
        backHref="/patrols"
        backLabel="Patrols"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            {schedule.unlockTime && (
              <span className="chip-slate">
                Unlock {schedule.unlockTime}
              </span>
            )}
            {schedule.lockdownTime && (
              <span className="chip-slate">
                Lock {schedule.lockdownTime}
              </span>
            )}
            {schedule.active ? (
              <span className="chip-mint">Active</span>
            ) : (
              <span className="chip-red">Paused</span>
            )}
          </span>
        }
        actions={
          <Link
            href={`/sites/${schedule.site.id}/edit#lockunlock-section`}
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

        <div className="card p-4 space-y-2 md:col-span-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Days
          </h2>
          {schedule.days.length === 0 ? (
            <span className="text-slate-400 italic">None set</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {schedule.days.map((d) => (
                <span key={d} className="chip-slate">
                  {DAY_LABEL[d] ?? d}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          Recent lock-up / unlock jobs ({recentJobs.length})
        </h2>
        {recentJobs.length === 0 ? (
          <p className="text-sm text-slate-400 italic">
            No jobs generated yet — the cron creates one per scheduled day.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentJobs.map((j) => (
              <li
                key={j.id}
                className="flex items-baseline justify-between gap-2 py-2"
              >
                <Link
                  href={`/dispatch/${j.id}`}
                  className="text-sm text-brand-navy hover:text-brand-blue-dark"
                >
                  {j.type === "LOCK" ? "Lock-up" : "Unlock"} ·{" "}
                  {fmtFull(j.scheduledFor)}
                  {j.handledByPartner
                    ? ` · ${j.handledByPartner.name} (partner)`
                    : j.assignedTo
                      ? ` · ${j.assignedTo.name}`
                      : ""} →
                </Link>
                <span className={JOB_STATUS_TONE[j.status] ?? "chip-slate"}>
                  {j.status.replace(/_/g, " ").toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
