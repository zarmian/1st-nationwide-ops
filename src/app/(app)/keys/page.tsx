import Link from "next/link";
import { prisma } from "@/lib/db";
import { FilterPanel } from "@/components/FilterPanel";
import { KeysTable, type KeyTableRow } from "./_components/KeysTable";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  WITH_US: "With us",
  WITH_OFFICER: "With officer",
  WITH_CUSTOMER: "With customer",
  LOST: "Lost",
  RETIRED: "Retired",
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
        keySet: { select: { id: true, label: true, internalNo: true } },
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

  // Group keys by KeySet so a set renders as one row (expandable) instead
  // of one row per key. Loose keys (no set) keep their own row.
  // Order within a set is preserved from the query.
  const rows: KeyTableRow[] = [];
  const setIndex = new Map<string, number>();
  for (const k of keys) {
    const keyEntry = {
      id: k.id,
      internalNo: k.internalNo,
      label: k.label,
      type: k.type,
      status: k.status,
      site: k.site,
      currentHolder: k.currentHolder,
    };
    if (k.keySet) {
      const existing = setIndex.get(k.keySet.id);
      if (existing != null) {
        const row = rows[existing] as Extract<KeyTableRow, { kind: "set" }>;
        row.keys.push(keyEntry);
      } else {
        setIndex.set(k.keySet.id, rows.length);
        rows.push({
          kind: "set",
          setId: k.keySet.id,
          setLabel: k.keySet.label,
          setInternalNo: k.keySet.internalNo,
          site: k.site,
          keys: [keyEntry],
        });
      }
    } else {
      rows.push({ kind: "loose", key: keyEntry });
    }
  }

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

      <FilterPanel
        clearAllHref="/keys"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete(k);
            const qs = sp.toString();
            return qs ? `/keys?${qs}` : "/keys";
          };
          if (q) filters.push({ label: `Search: ${q}`, clearHref: drop("q") });
          if (statusFilter) {
            filters.push({
              label: `Status: ${STATUS_LABEL[statusFilter] ?? statusFilter}`,
              clearHref: drop("status"),
            });
          }
          if (siteFilter) {
            const siteName =
              sites.find((s) => s.id === siteFilter)?.name ?? "Site";
            filters.push({ label: `Site: ${siteName}`, clearHref: drop("site") });
          }
          if (holderFilter) {
            const holderName =
              holderFilter === "none"
                ? "No holder"
                : holders.find((h) => h.id === holderFilter)?.name ?? "Holder";
            filters.push({
              label: `Holder: ${holderName}`,
              clearHref: drop("holder"),
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
        </form>
      </FilterPanel>

      <KeysTable
        rows={rows}
        footer={
          keys.length === 200
            ? "Showing first 200 keys — narrow the filters to see more."
            : undefined
        }
        emptyState={
          q || statusFilter || siteFilter || holderFilter
            ? "No keys match these filters."
            : "No keys recorded yet. Add keys per site from the site detail."
        }
      />
    </div>
  );
}
