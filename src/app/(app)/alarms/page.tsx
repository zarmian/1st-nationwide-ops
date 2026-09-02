import Link from "next/link";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/dates";
import {
  computeAlarmSla,
  summariseAlarmSla,
  SLA_CHIP,
  slaTimingLabel,
  DEFAULT_SLA_TARGET_MINS,
  type AlarmSlaRow,
} from "@/lib/alarmSla";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;

function PriorityChip({ p }: { p: string }) {
  if (p === "HIGH") return <span className="chip-red">{p}</span>;
  if (p === "LOW") return <span className="chip-slate">{p}</span>;
  return <span className="chip-amber">{p}</span>;
}

function OutcomeChip({ o }: { o: string | null }) {
  if (!o) return <span className="text-slate-400">—</span>;
  const label = o.replace(/_/g, " ").toLowerCase();
  if (o === "GENUINE" || o === "ESCALATED_TO_POLICE")
    return <span className="chip-red">{label}</span>;
  if (o === "FALSE_ALARM") return <span className="chip-amber">{label}</span>;
  if (o === "RESOLVED") return <span className="chip-mint">{label}</span>;
  return <span className="chip-slate">{label}</span>;
}

export default async function AlarmsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  await requireStaff();

  const days =
    WINDOWS.find((w) => String(w) === searchParams.days) ?? 30;
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);

  const alarms = await prisma.alarmEvent.findMany({
    where: { receivedAt: { gte: from } },
    orderBy: { receivedAt: "desc" },
    take: 300,
    select: {
      id: true,
      receivedAt: true,
      priority: true,
      outcome: true,
      closedAt: true,
      site: { select: { id: true, name: true, code: true } },
      assignedTo: { select: { name: true } },
      job: { select: { startedAt: true, status: true } },
    },
  });

  const rows = alarms.map((a) => {
    const sla = computeAlarmSla({
      receivedAt: a.receivedAt,
      arrivedAt: a.job?.startedAt ?? null,
      priority: a.priority,
      now,
    });
    return { a, sla };
  });

  const summary = summariseAlarmSla(
    rows.map(({ sla }): AlarmSlaRow => ({
      status: sla.status,
      responseMins: sla.responseMins,
      arrived: sla.arrived,
    })),
  );

  return (
    <div className="section">
      <PageHeader
        title="Alarm responses"
        subtitle={`Response times against target, and outcomes. Targets: high ${DEFAULT_SLA_TARGET_MINS.HIGH}m · medium ${DEFAULT_SLA_TARGET_MINS.MEDIUM}m · low ${DEFAULT_SLA_TARGET_MINS.LOW}m (received → on-site).`}
        actions={
          <Link href="/operations" className="btn-secondary text-sm">
            Operations →
          </Link>
        }
      />

      {/* Window filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Last</span>
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={`/alarms?days=${w}`}
            className={w === days ? "pill pill-active" : "pill pill-idle"}
          >
            {w} days
          </Link>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="kpi">
          <div className="kpi-label">Open</div>
          <div className="kpi-value text-brand-navy">{summary.open}</div>
          <div className="kpi-hint">still responding</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg response</div>
          <div className="kpi-value text-brand-navy">
            {summary.avgResponseMins != null ? `${summary.avgResponseMins}m` : "—"}
          </div>
          <div className="kpi-hint">received → on site</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">SLA met</div>
          <div
            className={
              "kpi-value " +
              (summary.slaMetPct != null && summary.slaMetPct < 90
                ? "text-amber-700"
                : "text-success")
            }
          >
            {summary.slaMetPct != null ? `${summary.slaMetPct}%` : "—"}
          </div>
          <div className="kpi-hint">of attended alarms</div>
        </div>
        <div
          className={
            summary.breached > 0
              ? "card-accent p-5 flex flex-col gap-1.5"
              : "kpi"
          }
        >
          <div className="kpi-label">Breaches</div>
          <div
            className={
              "kpi-value " +
              (summary.breached > 0 ? "text-red-600" : "text-brand-navy")
            }
          >
            {summary.breached}
          </div>
          <div className="kpi-hint">over target</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            Alarms — last {days} days
          </h2>
          <p className="text-xs text-slate-500">{rows.length} received</p>
        </div>
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Received</th>
                <th>Site</th>
                <th>Priority</th>
                <th>Response</th>
                <th>SLA</th>
                <th>Outcome</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, sla }) => {
                const chip = SLA_CHIP[sla.status];
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">
                      <Link
                        href={`/alarms/${a.id}`}
                        className="text-brand-navy hover:text-brand-blue-dark"
                      >
                        {formatDateTime(a.receivedAt)}
                      </Link>
                    </td>
                    <td>
                      <Link
                        href={`/sites/${a.site.id}/edit`}
                        className="font-medium text-brand-navy hover:text-brand-blue-dark"
                      >
                        {a.site.code ? `${a.site.code} · ` : ""}
                        {a.site.name}
                      </Link>
                    </td>
                    <td>
                      <PriorityChip p={a.priority} />
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-slate-700">
                      {sla.arrived ? `${sla.responseMins}m` : slaTimingLabel(sla)}
                    </td>
                    <td>
                      <span className={chip.chip}>{chip.label}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      <OutcomeChip o={a.outcome} />
                    </td>
                    <td className="text-slate-600 whitespace-nowrap">
                      {a.assignedTo?.name ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No alarms received in the last {days} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
