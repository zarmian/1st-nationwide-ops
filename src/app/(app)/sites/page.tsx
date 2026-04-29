import Link from "next/link";
import { prisma } from "@/lib/db";
import { SearchBox } from "./_components/SearchBox";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SITE_TYPES: { v: string; label: string }[] = [
  { v: "COMMERCIAL", label: "Commercial" },
  { v: "RESIDENTIAL", label: "Residential" },
  { v: "RETAIL", label: "Retail" },
  { v: "STORAGE", label: "Storage" },
  { v: "INDUSTRIAL", label: "Industrial" },
  { v: "OTHER", label: "Other" },
];

const SERVICES: { v: string; label: string }[] = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "KEYHOLDING", label: "Keyholding" },
  { v: "PATROL", label: "Mobile patrol" },
  { v: "LOCKUP", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "VPI", label: "VPI" },
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
  { v: "ADHOC", label: "Ad-hoc" },
];

const SERVICE_LABEL = Object.fromEntries(SERVICES.map((s) => [s.v, s.label]));

const ACTIVE_ONBOARDING_STAGES = [
  "PROPOSED",
  "SURVEY",
  "FRONT_KEY",
  "SHUTTER_KEY",
  "ALARM_FOB",
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
  const { q, region, service, type } = searchParams;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const where = {
    AND: [
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { addressLine: { contains: q, mode: "insensitive" as const } },
              { postcode: { contains: q.replace(/\s+/g, ""), mode: "insensitive" as const } },
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

  const [sites, totalShown, kpis, regions] = await Promise.all([
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
  ]);

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

      <form className="card p-3 flex flex-wrap gap-2 items-end">
        <SearchBox defaultValue={q ?? ""} />
        <div>
          <label className="label" htmlFor="region">
            Region
          </label>
          <select
            id="region"
            name="region"
            defaultValue={region ?? ""}
            className="input min-w-[140px]"
          >
            <option value="">All</option>
            {regions.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="service">
            Service
          </label>
          <select
            id="service"
            name="service"
            defaultValue={service ?? ""}
            className="input min-w-[160px]"
          >
            <option value="">All</option>
            {SERVICES.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ""}
            className="input min-w-[140px]"
          >
            <option value="">All</option>
            {SITE_TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-secondary" type="submit">
          Filter
        </button>
      </form>

      <KpiStrip kpis={kpis} />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Code
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Name
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Postcode
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Type
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Services
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Region
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sites.map((s) => {
              const onboarding = s.onboardingPipelines[0];
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wider text-slate-500">
                    {s.code ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/sites/${s.id}`}
                        className="font-medium text-brand-navy hover:text-brand-mint-dark"
                      >
                        {s.name}
                      </Link>
                      {onboarding && (
                        <span className="chip-amber">
                          Onboarding · {prettyStage(onboarding.stage)}
                        </span>
                      )}
                    </div>
                    {(s.customer?.name || s.partner?.name) && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {s.customer?.name ??
                          (s.partner?.name
                            ? `${s.partner.name} (partner)`
                            : "")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {s.postcodeFormatted}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="chip-slate">
                      {prettyType(s.type as string)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {s.services.map((svc) => (
                        <span key={svc} className="chip-mint">
                          {SERVICE_LABEL[svc] ?? svc.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.region?.name ? (
                      <span className="chip-slate">{s.region.name}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sites.length === 0 && (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={6}>
                  No sites match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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

function prettyType(t: string) {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function prettyStage(stage: string) {
  return stage
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
