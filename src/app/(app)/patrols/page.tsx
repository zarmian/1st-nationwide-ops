import Link from "next/link";
import { prisma } from "@/lib/db";
import { FilterPanel } from "@/components/FilterPanel";
import {
  reassignSchedule,
  reassignVisit,
  toggleScheduleActive,
} from "./_actions";
import {
  QuickReassignSchedule,
  QuickReassignVisit,
  ToggleActive,
} from "./_components/QuickReassign";

export const dynamic = "force-dynamic";

const DAY_LABEL: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

const FREQ_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-mint",
  COMPLETED: "chip-mint",
  LATE: "chip-amber",
  MISSED: "chip-red",
};

function fmt(d: Date): string {
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PatrolsPage({
  searchParams,
}: {
  searchParams: { region?: string; officer?: string; kind?: string };
}) {
  const regionFilter = searchParams.region ? Number(searchParams.region) : null;
  const officerFilter = searchParams.officer ?? "";
  const kindFilter = searchParams.kind ?? "";

  const scheduleWhere: any = {};
  if (regionFilter && Number.isFinite(regionFilter)) {
    scheduleWhere.site = { regionId: regionFilter };
  }
  if (officerFilter === "none") {
    scheduleWhere.assignedOfficerId = null;
  } else if (officerFilter) {
    scheduleWhere.assignedOfficerId = officerFilter;
  }
  if (kindFilter) scheduleWhere.kind = kindFilter;

  const visitWhere: any = {
    scheduledAt: { gte: new Date() },
  };
  if (regionFilter && Number.isFinite(regionFilter)) {
    visitWhere.site = { regionId: regionFilter };
  }
  if (officerFilter === "none") visitWhere.officerId = null;
  else if (officerFilter) visitWhere.officerId = officerFilter;

  const [schedules, upcomingVisits, regions, officers, totals] =
    await Promise.all([
      prisma.patrolSchedule.findMany({
        where: scheduleWhere,
        orderBy: [{ active: "desc" }, { kind: "asc" }, { dayOfWeek: "asc" }],
        include: {
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              region: { select: { name: true } },
            },
          },
          assignedOfficer: { select: { id: true, name: true } },
        },
      }),
      prisma.patrolVisit.findMany({
        where: visitWhere,
        orderBy: { scheduledAt: "asc" },
        take: 50,
        include: {
          site: { select: { id: true, name: true, code: true } },
          officer: { select: { id: true, name: true } },
          patrolSchedule: { select: { kind: true } },
        },
      }),
      prisma.region.findMany({ orderBy: { name: "asc" } }),
      prisma.user.findMany({
        where: { role: { in: ["OFFICER", "DISPATCHER"] }, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.patrolVisit.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { scheduledAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      }),
    ]);

  const last7 = totals.reduce(
    (acc, t) => ({ ...acc, [t.status]: t._count._all }),
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Patrols</h1>
        <p className="text-sm text-slate-500">
          Schedules and upcoming visits across all sites.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          { k: "PENDING", label: "Pending (7d)" },
          { k: "IN_PROGRESS", label: "In progress" },
          { k: "COMPLETED", label: "Completed" },
          { k: "LATE", label: "Late" },
          { k: "MISSED", label: "Missed" },
        ].map((s) => (
          <div key={s.k} className="card p-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {s.label}
            </div>
            <div className="text-2xl font-semibold text-brand-navy tabular-nums">
              {(last7[s.k] ?? 0).toLocaleString("en-GB")}
            </div>
          </div>
        ))}
      </div>

      <FilterPanel
        clearAllHref="/patrols"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete(k);
            const qs = sp.toString();
            return qs ? `/patrols?${qs}` : "/patrols";
          };
          if (searchParams.region) {
            const r = regions.find(
              (x) => x.id === Number(searchParams.region),
            );
            filters.push({
              label: `Region: ${r?.name ?? searchParams.region}`,
              clearHref: drop("region"),
            });
          }
          if (officerFilter) {
            const label =
              officerFilter === "none"
                ? "Unassigned"
                : officers.find((o) => o.id === officerFilter)?.name ??
                  "Officer";
            filters.push({
              label: `Officer: ${label}`,
              clearHref: drop("officer"),
            });
          }
          if (kindFilter) {
            filters.push({
              label: `Kind: ${kindFilter === "VPI" ? "VPI" : "Patrol"}`,
              clearHref: drop("kind"),
            });
          }
          return filters;
        })()}
      >
        <form className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="region">
              Region
            </label>
            <select
              id="region"
              name="region"
              defaultValue={searchParams.region ?? ""}
              className="input"
            >
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="officer">
              Officer
            </label>
            <select
              id="officer"
              name="officer"
              defaultValue={officerFilter}
              className="input"
            >
              <option value="">All officers</option>
              <option value="none">Unassigned</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="kind">
              Kind
            </label>
            <select
              id="kind"
              name="kind"
              defaultValue={kindFilter}
              className="input"
            >
              <option value="">All</option>
              <option value="PATROL">Patrol</option>
              <option value="VPI">VPI</option>
            </select>
          </div>
          <button type="submit" className="btn-secondary text-sm">
            Apply
          </button>
        </form>
      </FilterPanel>

      <div className="grid xl:grid-cols-[1fr_420px] gap-5">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              Schedules ({schedules.length})
            </h2>
            <p className="text-xs text-slate-500">
              Inline-edit officer to reassign. Click status chip to pause /
              resume.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Site
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Kind
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Day · Freq
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Officer
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/sites/${s.site.id}`}
                      className="font-medium text-brand-navy hover:text-brand-mint-dark"
                    >
                      {s.site.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {s.site.code ? `${s.site.code} · ` : ""}
                      {s.site.region?.name ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {s.kind === "VPI" ? "VPI" : "Patrol"}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {DAY_LABEL[s.dayOfWeek] ?? s.dayOfWeek} ·{" "}
                    {FREQ_LABEL[s.frequency] ?? s.frequency}
                  </td>
                  <td className="px-4 py-2">
                    <QuickReassignSchedule
                      scheduleId={s.id}
                      currentOfficerId={s.assignedOfficerId}
                      officers={officers}
                      reassign={reassignSchedule}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <ToggleActive
                      scheduleId={s.id}
                      active={s.active}
                      toggle={toggleScheduleActive}
                    />
                  </td>
                </tr>
              ))}
              {schedules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No schedules match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Upcoming visits</h2>
            <p className="text-xs text-slate-500">
              Next {upcomingVisits.length} visits, soonest first.
            </p>
          </div>
          {upcomingVisits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">
              Nothing scheduled.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcomingVisits.map((v) => (
                <li key={v.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/sites/${v.site.id}`}
                      className="font-medium text-brand-navy hover:text-brand-mint-dark"
                    >
                      {v.site.name}
                    </Link>
                    <span className={STATUS_TONE[v.status] ?? "chip-slate"}>
                      {v.status.toLowerCase()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmt(v.scheduledAt)}
                    {v.patrolSchedule
                      ? ` · ${v.patrolSchedule.kind === "VPI" ? "VPI" : "Patrol"}`
                      : ""}
                  </div>
                  <QuickReassignVisit
                    visitId={v.id}
                    currentOfficerId={v.officerId}
                    officers={officers}
                    reassign={reassignVisit}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
