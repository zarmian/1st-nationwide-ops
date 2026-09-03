import Link from "next/link";
import type { ComponentType } from "react";
import { Home, UserRound, Building2, AlertTriangle, Archive } from "lucide-react";
import { prisma } from "@/lib/db";
import { FilterPanel } from "@/components/FilterPanel";
import { PageHeader } from "@/components/PageHeader";
import { KeysTable, type KeyTableRow } from "./_components/KeysTable";
import { Pagination } from "@/components/Pagination";
import { STAT_TONE, type StatTone } from "@/components/StatCard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const STATUS_META: Record<
  string,
  {
    label: string;
    icon: ComponentType<{ size?: number | string; className?: string }>;
    tone: StatTone;
  }
> = {
  WITH_US: { label: "With us", icon: Home, tone: "blue" },
  WITH_OFFICER: { label: "With officer", icon: UserRound, tone: "indigo" },
  WITH_CUSTOMER: { label: "With customer", icon: Building2, tone: "emerald" },
  LOST: { label: "Lost", icon: AlertTriangle, tone: "rose" },
  RETIRED: { label: "Retired", icon: Archive, tone: "amber" },
};

export default async function KeysPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    status?: string;
    site?: string;
    holder?: string;
    page?: string;
  };
}) {
  const q = searchParams.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.page) || 1);
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

  const [keys, sites, holders, totalsByStatus, keyTotal] = await Promise.all([
    prisma.key.findMany({
      where,
      orderBy: [{ status: "asc" }, { internalNo: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
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
    prisma.key.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(keyTotal / PAGE_SIZE));

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
      <PageHeader
        title="Keys"
        subtitle="Every key, fob, padlock, and code we hold across all sites."
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {Object.entries(STATUS_META).map(([k, meta]) => {
          const count = counts[k] ?? 0;
          // "Lost" reads red only when there actually are lost keys — a
          // clean zero shouldn't glow like an alert.
          const tone: StatTone =
            k === "LOST" && count === 0 ? "emerald" : meta.tone;
          const tk = STAT_TONE[tone];
          const Icon = meta.icon;
          const active = statusFilter === k;
          return (
            <Link
              key={k}
              href={`/keys?status=${k}`}
              aria-current={active ? "true" : undefined}
              className={
                "relative overflow-hidden rounded-2xl border bg-white p-3 shadow-card " +
                "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 " +
                (active ? "ring-2 ring-brand-blue/50 " : "") +
                tk.border
              }
            >
              <div
                aria-hidden
                className={
                  "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-[0.12] blur-2xl " +
                  tk.wash
                }
              />
              <div className="relative flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {meta.label}
                </span>
                <span
                  className={
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm " +
                    tk.chip
                  }
                >
                  <Icon size={14} />
                </span>
              </div>
              <div
                className={
                  "relative mt-1.5 text-2xl font-semibold tabular-nums tracking-tight " +
                  tk.value
                }
              >
                {count.toLocaleString("en-GB")}
              </div>
            </Link>
          );
        })}
      </div>

      <FilterPanel
        clearAllHref="/keys"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete(k);
            sp.delete("page");
            const qs = sp.toString();
            return qs ? `/keys?${qs}` : "/keys";
          };
          if (q) filters.push({ label: `Search: ${q}`, clearHref: drop("q") });
          if (statusFilter) {
            filters.push({
              label: `Status: ${STATUS_META[statusFilter]?.label ?? statusFilter}`,
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
          keyTotal > 0
            ? `${keyTotal.toLocaleString("en-GB")} key${
                keyTotal === 1 ? "" : "s"
              } · page ${page} of ${totalPages}`
            : undefined
        }
        emptyState={
          q || statusFilter || siteFilter || holderFilter
            ? "No keys match these filters."
            : "No keys recorded yet. Add keys per site from the site detail."
        }
      />

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            page={page}
            totalPages={totalPages}
            basePath="/keys"
            searchParams={searchParams}
          />
        </div>
      )}
    </div>
  );
}
