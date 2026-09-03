import Link from "next/link";
import { Users, UserCheck, Radio, UserX } from "lucide-react";
import { prisma } from "@/lib/db";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { roleLabel } from "@/lib/roleLabel";
import { TimeAgo } from "@/components/TimeAgo";
import { FilterPanel } from "@/components/FilterPanel";
import { statusFor } from "@/lib/compliance";
import { formatDate } from "@/lib/dates";

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

  const [officers, regions, totals, activeTotal, onDutyTotal] =
    await Promise.all([
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
      prisma.user.count({
        where: { role: { in: ["OFFICER", "DISPATCHER"] }, active: true },
      }),
      prisma.user.count({
        where: {
          role: { in: ["OFFICER", "DISPATCHER"] },
          active: true,
          onDuty: true,
        },
      }),
    ]);

  const now = new Date();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Officers"
        subtitle="Roster of officers and office staff."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/compliance" className="btn-secondary">
              Compliance register
            </Link>
            <Link href="/officers/new" className="btn-primary">
              + New officer
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone="blue"
          label="Roster"
          value={totals._count.toLocaleString("en-GB")}
          hint="officers + dispatchers"
          icon={Users}
        />
        <StatCard
          tone="emerald"
          label="Active"
          value={activeTotal.toLocaleString("en-GB")}
          hint="currently employed"
          icon={UserCheck}
        />
        <StatCard
          tone="amber"
          label="On duty"
          value={onDutyTotal.toLocaleString("en-GB")}
          hint="signed on now"
          icon={Radio}
        />
        <StatCard
          tone="indigo"
          label="Inactive"
          value={(totals._count - activeTotal).toLocaleString("en-GB")}
          hint="off the roster"
          icon={UserX}
        />
      </div>

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
              <span className="text-slate-600">{roleLabel(o.role)}</span>
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
            cell: (o) => {
              const st = statusFor(o.siaExpiry, now);
              return (
                <div>
                  <div className="text-slate-600 font-mono text-xs">
                    {o.siaNumber ?? "—"}
                  </div>
                  {o.siaExpiry ? (
                    <div
                      className={
                        "text-[11px] " +
                        (st === "expired"
                          ? "text-red-600 font-medium"
                          : st === "expiring"
                            ? "text-amber-700 font-medium"
                            : "text-slate-400")
                      }
                    >
                      {st === "expired" ? "Expired " : "Exp "}
                      {formatDate(o.siaExpiry)}
                    </div>
                  ) : o.siaNumber ? (
                    <div className="text-[11px] text-amber-700">
                      No expiry set
                    </div>
                  ) : null}
                </div>
              );
            },
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
