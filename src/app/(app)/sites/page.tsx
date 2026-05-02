import Link from "next/link";
import { prisma } from "@/lib/db";
import { SitesToolbar } from "./_components/SitesToolbar";
import { SitesTable, type SiteRow } from "./_components/SitesTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const ACTIVE_ONBOARDING_STAGES = [
  "PROPOSED",
  "SURVEY",
  "KEY_COLLECTION",
] as const;

export default async function SitesPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    region?: string;
    service?: string;
    type?: string;
    page?: string;
  };
}) {
  const q = searchParams.q ?? "";
  const region = searchParams.region ?? "";
  const service = searchParams.service ?? "";
  const type = searchParams.type ?? "";
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const where = {
    AND: [
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { addressLine: { contains: q, mode: "insensitive" as const } },
              {
                postcode: {
                  contains: q.replace(/\s+/g, ""),
                  mode: "insensitive" as const,
                },
              },
              { code: { contains: q, mode: "insensitive" as const } },
              {
                customer: {
                  name: { contains: q, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {},
      region
        ? { region: { name: { equals: region, mode: "insensitive" as const } } }
        : {},
      service ? { services: { has: service as any } } : {},
      type ? { type: type as any } : {},
      { active: true },
    ],
  };

  const [sites, totalShown, kpis, regions, customers, partners] =
    await Promise.all([
      prisma.site.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          partner: { select: { name: true } },
          region: { select: { name: true } },
          onboardingPipelines: {
            where: { stage: { in: ACTIVE_ONBOARDING_STAGES as any } },
            select: { stage: true },
            take: 1,
          },
        },
        orderBy: [{ code: "asc" }, { name: "asc" }],
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
      prisma.site.count({ where }),
      loadKpis(),
      prisma.region.findMany({ orderBy: { name: "asc" } }),
      prisma.customer.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.partner.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const rows: SiteRow[] = sites.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    postcodeFormatted: s.postcodeFormatted,
    type: s.type,
    services: s.services,
    regionName: s.region?.name ?? null,
    customerName: s.customer?.name ?? null,
    partnerName: s.partner?.name ?? null,
    onboardingStage: s.onboardingPipelines[0]?.stage ?? null,
  }));

  const totalPages = Math.max(1, Math.ceil(totalShown / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const firstShown = totalShown === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(safePage * PAGE_SIZE, totalShown);

  const exportQs = new URLSearchParams();
  if (q) exportQs.set("q", q);
  if (region) exportQs.set("region", region);
  if (service) exportQs.set("service", service);
  if (type) exportQs.set("type", type);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Sites</h1>
          <p className="text-sm text-slate-500">
            Single source of truth for every site we cover.
          </p>
        </div>
        <Link href="/sites/new" className="btn-primary">
          + New site
        </Link>
      </div>

      <SitesToolbar
        regions={regions.map((r) => ({ name: r.name }))}
        initial={{ q, region, service, type }}
      />

      <KpiStrip kpis={kpis} />

      <SitesTable
        rows={rows}
        customers={customers}
        partners={partners}
        regions={regions}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <div>
          Showing {firstShown}–{lastShown} of {totalShown}
          {" · "}
          <Link
            href={`/api/sites/export${exportQs.toString() ? `?${exportQs}` : ""}`}
            className="text-brand-mint-dark hover:underline"
          >
            Export CSV
          </Link>
        </div>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          searchParams={searchParams}
        />
      </div>
    </div>
  );
}

async function loadKpis() {
  const [totalActive, withKeyholding, patrolRouteSites, lockUnlockSites, onboarding] =
    await Promise.all([
      prisma.site.count({ where: { active: true } }),
      prisma.site.count({
        where: { active: true, services: { has: "KEYHOLDING" } },
      }),
      prisma.patrolSchedule
        .findMany({ select: { siteId: true }, distinct: ["siteId"] })
        .then((rs) => rs.length),
      prisma.lockUnlockSchedule
        .findMany({ select: { siteId: true }, distinct: ["siteId"] })
        .then((rs) => rs.length),
      prisma.onboardingPipeline.count({
        where: { stage: { in: ACTIVE_ONBOARDING_STAGES as any } },
      }),
    ]);

  return { totalActive, withKeyholding, patrolRouteSites, lockUnlockSites, onboarding };
}

function KpiStrip({
  kpis,
}: {
  kpis: {
    totalActive: number;
    withKeyholding: number;
    patrolRouteSites: number;
    lockUnlockSites: number;
    onboarding: number;
  };
}) {
  const items = [
    { label: "Total active", value: kpis.totalActive },
    { label: "With keyholding", value: kpis.withKeyholding },
    { label: "Patrol routes", value: kpis.patrolRouteSites },
    { label: "Lock/unlock daily", value: kpis.lockUnlockSites },
    { label: "Onboarding pipeline", value: kpis.onboarding },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((it) => (
        <div key={it.label} className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            {it.label}
          </div>
          <div className="text-3xl font-semibold text-brand-navy mt-1 tabular-nums">
            {it.value.toLocaleString("en-GB")}
          </div>
        </div>
      ))}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  const link = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== "page") qs.set(k, v);
    }
    qs.set("page", String(p));
    return `/sites?${qs.toString()}`;
  };

  const pages: (number | "…")[] = [];
  const push = (n: number | "…") => pages.push(n);
  push(1);
  if (page > 3) push("…");
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) {
    push(p);
  }
  if (page < totalPages - 2) push("…");
  if (totalPages > 1) push(totalPages);

  return (
    <nav className="flex items-center gap-1">
      <Link
        href={page > 1 ? link(page - 1) : "#"}
        aria-disabled={page === 1}
        className={`px-2 py-1 rounded-lg border border-slate-200 ${
          page === 1
            ? "text-slate-300 pointer-events-none"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        ‹
      </Link>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-2 text-slate-400">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={link(p)}
            className={`min-w-[32px] text-center px-2 py-1 rounded-lg text-sm ${
              p === page
                ? "bg-brand-navy text-white"
                : "text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {p}
          </Link>
        ),
      )}
      <Link
        href={page < totalPages ? link(page + 1) : "#"}
        aria-disabled={page === totalPages}
        className={`px-2 py-1 rounded-lg border border-slate-200 ${
          page === totalPages
            ? "text-slate-300 pointer-events-none"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        ›
      </Link>
    </nav>
  );
}
