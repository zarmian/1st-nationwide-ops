import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  WITH_US: "With us",
  WITH_OFFICER: "With officer",
  WITH_CUSTOMER: "With customer",
  LOST: "Lost",
  RETIRED: "Retired",
};

const STATUS_TONE: Record<string, string> = {
  WITH_US: "chip-mint",
  WITH_OFFICER: "chip-amber",
  WITH_CUSTOMER: "chip-slate",
  LOST: "chip-red",
  RETIRED: "chip-slate",
};

export default async function KeysPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; site?: string; holder?: string };
}) {
  const q = searchParams.q?.trim() ?? "";
  const statusFilter = searchParams.status ?? "";
  const siteFilter = searchParams.site ?? "";
  const holderFilter = searchParams.holder ?? "";

  const where: any = {};
  if (statusFilter) where.status = statusFilter;
  if (siteFilter) where.siteId = siteFilter;
  if (holderFilter === "none") where.currentHolderUserId = null;
  else if (holderFilter) where.currentHolderUserId = holderFilter;
  if (q) {
    where.OR = [
      { label: { contains: q, mode: "insensitive" } },
      { internalNo: { contains: q, mode: "insensitive" } },
      { qrId: { contains: q, mode: "insensitive" } },
      { site: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [keys, sites, holders, totalsByStatus] = await Promise.all([
    prisma.key.findMany({
      where,
      orderBy: [{ status: "asc" }, { internalNo: "asc" }],
      take: 200,
      include: {
        site: { select: { id: true, name: true, code: true } },
        currentHolder: { select: { id: true, name: true } },
        keySet: { select: { id: true, label: true } },
      },
    }),
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ["OFFICER", "DISPATCHER", "ADMIN"] },
        active: true,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.key.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const t of totalsByStatus) counts[t.status] = t._count._all;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Keys</h1>
        <p className="text-sm text-slate-500">
          Every key, fob, padlock, and code we hold across all sites.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {Object.entries(STATUS_LABEL).map(([k, label]) => (
          <Link
            key={k}
            href={`/keys?status=${k}`}
            className={`card p-3 hover:shadow-md transition-shadow ${
              statusFilter === k ? "ring-2 ring-brand-mint/40" : ""
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {label}
            </div>
            <div className="text-2xl font-semibold text-brand-navy tabular-nums">
              {(counts[k] ?? 0).toLocaleString("en-GB")}
            </div>
          </Link>
        ))}
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
            placeholder="Label, code, site…"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="site">
            Site
          </label>
          <select
            id="site"
            name="site"
            defaultValue={siteFilter}
            className="input"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ` : ""}
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="holder">
            Holder
          </label>
          <select
            id="holder"
            name="holder"
            defaultValue={holderFilter}
            className="input"
          >
            <option value="">Any</option>
            <option value="none">No holder</option>
            {holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="status" value={statusFilter} />
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        {(q || statusFilter || siteFilter || holderFilter) && (
          <Link href="/keys" className="btn-ghost text-sm">
            Clear
          </Link>
        )}
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Code
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Label
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Type
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Site
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Holder
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Status
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {keys.map((k) => (
              <tr key={k.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                  {k.internalNo ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/keys/${k.id}`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {k.label}
                  </Link>
                  {k.keySet && (
                    <div className="text-xs text-slate-500">
                      Set: {k.keySet.label}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {k.type.charAt(0) + k.type.slice(1).toLowerCase()}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {k.site ? (
                    <Link
                      href={`/sites/${k.site.id}`}
                      className="hover:text-brand-mint-dark"
                    >
                      {k.site.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {k.currentHolder ? (
                    <Link
                      href={`/officers/${k.currentHolder.id}/edit`}
                      className="hover:text-brand-mint-dark"
                    >
                      {k.currentHolder.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={STATUS_TONE[k.status] ?? "chip-slate"}>
                    {STATUS_LABEL[k.status] ?? k.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/keys/${k.id}`} className="btn-ghost text-sm">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No keys match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {keys.length === 200 && (
          <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
            Showing first 200 — narrow the filters to see more.
          </div>
        )}
      </div>
    </div>
  );
}
