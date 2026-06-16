import Link from "next/link";
import { prisma } from "@/lib/db";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { FilterPanel } from "@/components/FilterPanel";

export const dynamic = "force-dynamic";

export default async function OfficersPage({
  searchParams,
}: {
  searchParams: { region?: string; status?: string; q?: string };
}) {
  const regionFilter = searchParams.region
    ? Number(searchParams.region)
    : null;
  const statusFilter = searchParams.status ?? null; // active | inactive | onduty
  const q = searchParams.q?.trim() ?? "";

  const where: any = { role: { in: ["OFFICER", "DISPATCHER"] } };
  if (regionFilter && Number.isFinite(regionFilter)) where.regionId = regionFilter;
  if (statusFilter === "active") where.active = true;
  if (statusFilter === "inactive") where.active = false;
  if (statusFilter === "onduty") {
    where.active = true;
    where.onDuty = true;
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { siaNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const [officers, regions, totals] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        region: { select: { name: true } },
        _count: {
          select: { keysHeld: true, formSubmissions: true, patrolVisits: true },
        },
      },
    }),
    prisma.region.findMany({ orderBy: { name: "asc" } }),
    prisma.user.aggregate({
      where: { role: { in: ["OFFICER", "DISPATCHER"] } },
      _count: true,
    }),
  ]);

  const onDutyCount = officers.filter((o) => o.active && o.onDuty).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Officers"
        subtitle={
          <>
            Roster of officers and dispatchers — {totals._count} total,{" "}
            {onDutyCount} on duty.
          </>
        }
        actions={
          <Link href="/officers/new" className="btn-primary">
            + New officer
          </Link>
        }
      />

      <FilterPanel
        clearAllHref="/officers"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          if (q) {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete("q");
            filters.push({
              label: `Search: ${q}`,
              clearHref: `/officers?${sp.toString()}`,
            });
          }
          if (searchParams.region) {
            const regionName =
              regions.find((r) => r.id === Number(searchParams.region))?.name ??
              "Region";
            const sp = new URLSearchParams(searchParams as any);
            sp.delete("region");
            filters.push({
              label: `Region: ${regionName}`,
              clearHref: `/officers?${sp.toString()}`,
            });
          }
          if (searchParams.status) {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete("status");
            filters.push({
              label: `Status: ${searchParams.status}`,
              clearHref: `/officers?${sp.toString()}`,
            });
          }
          return filters;
        })()}
      >
        <form className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label" htmlFor="q">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Name, email, SIA…"
              className="input"
            />
          </div>
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
            <label className="label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={searchParams.status ?? ""}
              className="input"
            >
              <option value="">All</option>
              <option value="onduty">On duty</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <button type="submit" className="btn-secondary text-sm">
            Apply
          </button>
        </form>
      </FilterPanel>

      <DataTable
        rows={officers}
        rowHref={(o) => `/officers/${o.id}/edit`}
        emptyState={
          q || searchParams.region || searchParams.status ? (
            <>No officers match these filters.</>
          ) : (
            <div className="space-y-3">
              <p>No officers yet.</p>
              <Link href="/officers/new" className="btn-primary text-sm inline-block">
                + Create your first officer
              </Link>
            </div>
          )
        }
        columns={[
          {
            header: "Name",
            cell: (o) => (
              <div>
                <div className="font-medium text-brand-navy">{o.name}</div>
                <div className="text-xs text-slate-500">{o.email}</div>
                <div className="flex gap-1 mt-1">
                  {!o.active && (
                    <span className="chip-slate text-[10px]">Inactive</span>
                  )}
                  {o.active && o.onDuty && (
                    <span className="chip-mint text-[10px]">On duty</span>
                  )}
                </div>
              </div>
            ),
          },
          {
            header: "Role",
            cell: (o) => (
              <span className="text-slate-600">
                {o.role.charAt(0) + o.role.slice(1).toLowerCase()}
              </span>
            ),
          },
          {
            header: "Region",
            cell: (o) => (
              <span className="text-slate-600">{o.region?.name ?? "—"}</span>
            ),
          },
          {
            header: "SIA",
            cell: (o) => (
              <span className="text-slate-600 font-mono text-xs">
                {o.siaNumber ?? "—"}
              </span>
            ),
          },
          {
            header: "Keys",
            align: "right",
            cell: (o) => (
              <span className="tabular-nums text-slate-700">
                {o._count.keysHeld}
              </span>
            ),
          },
          {
            header: "Visits",
            align: "right",
            cell: (o) => (
              <span className="tabular-nums text-slate-700">
                {o._count.patrolVisits}
              </span>
            ),
          },
          {
            header: "Last seen",
            cell: (o) => (
              <TimeAgo
                date={o.lastSeenAt ?? null}
                className="text-slate-500 text-xs"
              />
            ),
          },
        ]}
      />
    </div>
  );
}
