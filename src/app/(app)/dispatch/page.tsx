import Link from "next/link";
import { prisma } from "@/lib/db";
import { DataTable } from "@/components/DataTable";
import { reassignJob } from "../patrols/_actions";
import { QuickReassignJob } from "../patrols/_components/QuickReassign";
import { CancelJobButton } from "./_components/CancelJobButton";

export const dynamic = "force-dynamic";

const liveStatuses = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVIEW_PENDING",
] as const;

function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const ms = Date.now() - date.getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-GB");
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const statusFilter =
    searchParams.status && (liveStatuses as readonly string[]).includes(searchParams.status)
      ? searchParams.status
      : "";

  const jobsWhere: any = statusFilter
    ? { status: statusFilter }
    : { status: { in: liveStatuses as any } };

  const [jobs, onDutyOfficers, countRows, assignableOfficers] = await Promise.all([
    prisma.job.findMany({
      where: jobsWhere,
      include: {
        site: { select: { id: true, name: true, postcodeFormatted: true } },
        customer: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
        partner: { select: { name: true } },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.user.findMany({
      where: {
        active: true,
        onDuty: true,
        role: { in: ["OFFICER", "DISPATCHER"] },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        lastLat: true,
        lastLng: true,
        lastSeenAt: true,
      },
    }),
    // Card counts stay independent of the active filter so users can see
    // every status total at a glance and click between them.
    prisma.job.groupBy({
      by: ["status"],
      where: { status: { in: liveStatuses as any } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const c of countRows) counts[c.status] = c._count._all;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Dispatch</h1>
          <p className="text-sm text-slate-500">Live jobs across all sites</p>
        </div>
        <Link href="/dispatch/new" className="btn-primary">
          + New job
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {liveStatuses.map((s) => {
          const isActive = statusFilter === s;
          return (
            <Link
              key={s}
              href={isActive ? "/dispatch" : `/dispatch?status=${s}`}
              className={`card p-3 hover:shadow-md transition-shadow ${
                isActive ? "ring-2 ring-brand-mint/40" : ""
              }`}
            >
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                {s.replace(/_/g, " ")}
              </div>
              <div className="text-2xl font-semibold text-brand-navy">
                {counts[s] ?? 0}
              </div>
            </Link>
          );
        })}
      </div>
      {statusFilter && (
        <div className="text-xs text-slate-500">
          Filtered to <span className="font-medium text-brand-navy">{statusFilter.replace(/_/g, " ")}</span>
          {" · "}
          <Link href="/dispatch" className="text-brand-mint-dark hover:underline">
            clear
          </Link>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold text-brand-navy">
            On duty ({onDutyOfficers.length})
          </h2>
          <p className="text-xs text-slate-500">
            Latest known position from <code className="text-xs bg-slate-100 px-1 rounded">/m/today</code>.
          </p>
        </div>
        {onDutyOfficers.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            No one is on duty right now.
          </p>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {onDutyOfficers.map((o) => {
              const hasLoc =
                typeof o.lastLat === "number" && typeof o.lastLng === "number";
              return (
                <li
                  key={o.id}
                  className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2"
                >
                  <div>
                    <Link
                      href={`/officers/${o.id}/edit`}
                      className="font-medium text-brand-navy hover:text-brand-mint-dark"
                    >
                      {o.name}
                    </Link>
                    <div className="text-[11px] text-slate-500">
                      {o.role.toLowerCase()} · seen {relativeTime(o.lastSeenAt)}
                    </div>
                  </div>
                  {hasLoc ? (
                    <a
                      href={`https://www.google.com/maps?q=${o.lastLat},${o.lastLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="chip-mint text-[10px]"
                    >
                      Map
                    </a>
                  ) : (
                    <span className="chip-slate text-[10px]">No GPS</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DataTable
        rows={jobs}
        emptyState={
          <div className="space-y-3">
            <p>No live jobs.</p>
            <Link href="/dispatch/new" className="btn-primary text-sm inline-block">
              + Create a job
            </Link>
          </div>
        }
        columns={[
          {
            header: "Type",
            cell: (j) => (
              <span className="font-medium text-brand-navy">
                {j.type.replace(/_/g, " ")}
              </span>
            ),
          },
          {
            header: "Site",
            cell: (j) => {
              if (!j.site) {
                return <span className="text-slate-400">—</span>;
              }
              const anchor =
                j.type === "LOCK" || j.type === "UNLOCK"
                  ? "#lockunlock-section"
                  : "";
              return (
                <div>
                  <Link
                    href={`/sites/${j.site.id}/edit${anchor}`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {j.site.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {j.site.postcodeFormatted}
                  </div>
                </div>
              );
            },
          },
          {
            header: "Customer",
            cell: (j) => (
              <span>{j.customer?.name ?? j.partner?.name ?? "—"}</span>
            ),
          },
          {
            header: "Source",
            cell: (j) => (
              <span className="chip-slate">
                {j.source.replace(/_/g, " ")}
              </span>
            ),
          },
          {
            header: "Assigned",
            cell: (j) => {
              // Pre-start jobs are inline-reassignable; live ones show the
              // current officer as plain text so dispatchers don't accidentally
              // change someone mid-job.
              const editable = j.status === "OPEN" || j.status === "ASSIGNED";
              if (editable) {
                return (
                  <QuickReassignJob
                    jobId={j.id}
                    currentOfficerId={j.assignedTo?.id ?? null}
                    officers={assignableOfficers}
                    reassign={reassignJob}
                  />
                );
              }
              return (
                j.assignedTo?.name ?? (
                  <span className="text-slate-400">—</span>
                )
              );
            },
          },
          {
            header: "Status",
            cell: (j) => <span className="chip-mint">{j.status}</span>,
          },
          {
            header: "Priority",
            cell: (j) =>
              j.priority === "HIGH" ? (
                <span className="chip-red">{j.priority}</span>
              ) : (
                <span className="chip-slate">{j.priority}</span>
              ),
          },
          {
            header: "",
            align: "right",
            cell: (j) => (
              <CancelJobButton
                jobId={j.id}
                jobLabel={`${j.type.replace(/_/g, " ")} @ ${j.site?.name ?? "site"}`}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
