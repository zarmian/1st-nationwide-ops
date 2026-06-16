import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

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

function PriorityChip({ p }: { p: string }) {
  if (p === "HIGH") return <span className="chip-red">{p}</span>;
  if (p === "LOW") return <span className="chip-slate">{p}</span>;
  return <span className="chip-amber">{p}</span>;
}

function OutcomeChip({ o }: { o: string | null }) {
  if (!o) return <span className="chip-slate">No outcome</span>;
  if (o === "GENUINE" || o === "ESCALATED_TO_POLICE")
    return <span className="chip-red">{o.replace(/_/g, " ")}</span>;
  if (o === "FALSE_ALARM")
    return <span className="chip-amber">{o.replace(/_/g, " ")}</span>;
  if (o === "RESOLVED") return <span className="chip-mint">RESOLVED</span>;
  return <span className="chip-slate">{o.replace(/_/g, " ")}</span>;
}

export default async function AlarmEventDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireStaff();

  const alarm = await prisma.alarmEvent.findUnique({
    where: { id: params.id },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          addressLine: true,
          city: true,
          postcodeFormatted: true,
        },
      },
      assignedTo: { select: { id: true, name: true } },
      job: {
        select: {
          id: true,
          type: true,
          status: true,
          assignedTo: { select: { name: true } },
        },
      },
    },
  });
  if (!alarm) notFound();

  const responseMins =
    alarm.closedAt
      ? Math.round(
          (alarm.closedAt.getTime() - alarm.receivedAt.getTime()) / 60000,
        )
      : null;

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title="Alarm event"
        backHref={`/sites/${alarm.site.id}/edit`}
        backLabel={alarm.site.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="chip-slate">
              {alarm.source.replace(/_/g, " ").toLowerCase()}
            </span>
            <PriorityChip p={alarm.priority} />
            <OutcomeChip o={alarm.outcome} />
            {responseMins != null && (
              <span className="chip-mint">{responseMins} min response</span>
            )}
          </span>
        }
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Site
          </h2>
          <Link
            href={`/sites/${alarm.site.id}/edit`}
            className="font-medium text-brand-navy hover:text-brand-blue-dark text-base"
          >
            {alarm.site.name} →
          </Link>
          <div className="text-sm text-slate-600">
            {alarm.site.addressLine}
            {alarm.site.city ? `, ${alarm.site.city}` : ""}
          </div>
          <div className="text-sm font-mono text-slate-500">
            {alarm.site.postcodeFormatted}
          </div>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Timeline
          </h2>
          <dl className="text-sm space-y-1">
            <Row label="Received">{fmtFull(alarm.receivedAt)}</Row>
            <Row label="Closed">{fmtFull(alarm.closedAt)}</Row>
            <Row label="Zone">{alarm.zone ?? "—"}</Row>
          </dl>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Assigned to
          </h2>
          {alarm.assignedTo ? (
            <Link
              href={`/officers/${alarm.assignedTo.id}/edit`}
              className="font-medium text-brand-navy hover:text-brand-blue-dark"
            >
              {alarm.assignedTo.name} →
            </Link>
          ) : (
            <span className="text-slate-400 italic">Nobody yet</span>
          )}
        </div>

        {alarm.job && (
          <div className="card p-4 space-y-2">
            <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
              Response job
            </h2>
            <Link
              href={`/dispatch/${alarm.job.id}`}
              className="font-medium text-brand-navy hover:text-brand-blue-dark"
            >
              {alarm.job.type.replace(/_/g, " ")} →
            </Link>
            <div className="text-xs text-slate-500">
              {alarm.job.status}
              {alarm.job.assignedTo
                ? ` · ${alarm.job.assignedTo.name}`
                : ""}
            </div>
          </div>
        )}
      </div>

      {(alarm.rawSubject || alarm.rawBody) && (
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Source email / message
          </h2>
          {alarm.rawSubject && (
            <div>
              <div className="text-xs text-slate-500">Subject</div>
              <div className="text-sm font-medium text-slate-800">
                {alarm.rawSubject}
              </div>
            </div>
          )}
          {alarm.rawBody && (
            <div>
              <div className="text-xs text-slate-500">Body</div>
              <pre className="text-xs whitespace-pre-wrap text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2 max-h-72 overflow-auto">
                {alarm.rawBody}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="card p-4 space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          Notes
        </h2>
        {alarm.notes ? (
          <p className="text-sm whitespace-pre-wrap text-slate-700">
            {alarm.notes}
          </p>
        ) : (
          <p className="text-sm text-slate-400 italic">No notes.</p>
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
