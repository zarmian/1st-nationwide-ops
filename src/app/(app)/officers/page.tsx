import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function fmtRelative(d: Date | null): string {
  if (!d) return "—";
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB");
}

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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Officers</h1>
          <p className="text-sm text-slate-500">
            Roster of officers and dispatchers — {totals._count} total,{" "}
            {onDutyCount} on duty.
          </p>
        </div>
        <Link href="/officers/new" className="btn-primary">
          + New officer
        </Link>
      </div>

      <form className="card p-3 flex flex-wrap items-end gap-3">
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
        {(q || searchParams.region || searchParams.status) && (
          <Link href="/officers" className="btn-ghost text-sm">
            Clear
          </Link>
        )}
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Name
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Role
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Region
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                SIA
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Keys
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Visits
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Last seen
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {officers.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/officers/${o.id}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {o.name}
                  </Link>
                  <div className="text-xs text-slate-500">{o.email}</div>
                  <div className="flex gap-1 mt-1">
                    {!o.active && (
                      <span className="chip-slate text-[10px]">Inactive</span>
                    )}
                    {o.active && o.onDuty && (
                      <span className="chip-mint text-[10px]">On duty</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {o.role.charAt(0) + o.role.slice(1).toLowerCase()}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {o.region?.name ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">
                  {o.siaNumber ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                  {o._count.keysHeld}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                  {o._count.patrolVisits}
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">
                  {fmtRelative(o.lastSeenAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/officers/${o.id}/edit`}
                    className="btn-ghost text-sm"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {officers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No officers match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
