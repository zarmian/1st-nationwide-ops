import Link from "next/link";
import { prisma } from "@/lib/db";
import { StartOnboardingForm } from "./_components/StartOnboardingForm";

export const dynamic = "force-dynamic";

const STAGE_ORDER = [
  "PROPOSED",
  "SURVEY",
  "KEY_COLLECTION",
  "GO_LIVE",
] as const;

const STAGE_LABEL: Record<string, string> = {
  PROPOSED: "Proposed",
  SURVEY: "Site survey",
  KEY_COLLECTION: "Key collection",
  GO_LIVE: "Live",
  CANCELLED: "Cancelled",
};

const STAGE_TONE: Record<string, string> = {
  PROPOSED: "chip-slate",
  SURVEY: "chip-amber",
  KEY_COLLECTION: "chip-amber",
  GO_LIVE: "chip-mint",
  CANCELLED: "chip-red",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { show?: string };
}) {
  const showAll = searchParams.show === "all";

  const [pipelines, eligibleSites] = await Promise.all([
    prisma.onboardingPipeline.findMany({
      where: showAll
        ? {}
        : { stage: { notIn: ["GO_LIVE", "CANCELLED"] } },
      orderBy: [{ stage: "asc" }, { updatedAt: "desc" }],
      include: {
        site: {
          select: {
            id: true,
            name: true,
            code: true,
            postcodeFormatted: true,
            region: { select: { name: true } },
          },
        },
        _count: { select: { jobs: true } },
      },
    }),
    prisma.site.findMany({
      where: {
        active: true,
        onboardingPipelines: { none: { stage: { notIn: ["GO_LIVE", "CANCELLED"] } } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, postcodeFormatted: true },
    }),
  ]);

  const byStage = new Map<string, typeof pipelines>();
  for (const p of pipelines) {
    const list = byStage.get(p.stage) ?? [];
    list.push(p);
    byStage.set(p.stage, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">
            Onboarding pipeline
          </h1>
          <p className="text-sm text-slate-500">
            Sites moving from proposed to live. Stage advances are manual.
          </p>
        </div>
        <Link
          href={showAll ? "/onboarding" : "/onboarding?show=all"}
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          {showAll ? "Hide finished" : "Show all (incl. live, cancelled)"}
        </Link>
      </div>

      <StartOnboardingForm sites={eligibleSites} />

      <div className="space-y-4">
        {STAGE_ORDER.map((stage) => {
          const rows = byStage.get(stage) ?? [];
          if (!showAll && stage === "GO_LIVE") return null;
          return (
            <StageSection
              key={stage}
              title={STAGE_LABEL[stage]}
              tone={STAGE_TONE[stage]}
              rows={rows}
            />
          );
        })}
        {showAll && (byStage.get("CANCELLED")?.length ?? 0) > 0 && (
          <StageSection
            title={STAGE_LABEL.CANCELLED}
            tone={STAGE_TONE.CANCELLED}
            rows={byStage.get("CANCELLED") ?? []}
          />
        )}
      </div>
    </div>
  );
}

function StageSection({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: string;
  rows: {
    id: string;
    program: string;
    targetGoLiveDate: Date | null;
    updatedAt: Date;
    site: {
      id: string;
      name: string;
      code: string | null;
      postcodeFormatted: string;
      region: { name: string } | null;
    };
    _count: { jobs: number };
  }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-brand-navy">{title}</h2>
          <span className={tone}>0</span>
        </div>
        <p className="text-sm text-slate-500 mt-1 italic">Nothing here.</p>
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-2 bg-slate-50/50">
        <h2 className="font-semibold text-brand-navy">{title}</h2>
        <span className={tone}>{rows.length}</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
              Code
            </th>
            <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
              Site
            </th>
            <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
              Program
            </th>
            <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
              Region
            </th>
            <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
              Jobs
            </th>
            <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
              Target go-live
            </th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-2 text-xs uppercase tracking-wider text-slate-500">
                {r.site.code ?? "—"}
              </td>
              <td className="px-4 py-2">
                <Link
                  href={`/onboarding/${r.id}`}
                  className="font-medium text-brand-navy hover:text-brand-mint-dark"
                >
                  {r.site.name}
                </Link>
                <div className="text-xs text-slate-500">
                  {r.site.postcodeFormatted}
                </div>
              </td>
              <td className="px-4 py-2">
                <span className="chip-slate">
                  {r.program.charAt(0) + r.program.slice(1).toLowerCase()}
                </span>
              </td>
              <td className="px-4 py-2 text-slate-600">
                {r.site.region?.name ?? "—"}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                {r._count.jobs}
              </td>
              <td className="px-4 py-2 text-slate-600">
                {r.targetGoLiveDate
                  ? r.targetGoLiveDate.toISOString().slice(0, 10)
                  : "—"}
              </td>
              <td className="px-4 py-2 text-right">
                <Link
                  href={`/onboarding/${r.id}`}
                  className="btn-ghost text-sm"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
