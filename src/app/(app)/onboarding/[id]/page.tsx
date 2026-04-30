import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StageAdvancer } from "./_components/StageAdvancer";
import { SetupJobs } from "./_components/SetupJobs";

export const dynamic = "force-dynamic";

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

export default async function OnboardingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [pipeline, officers] = await Promise.all([
    prisma.onboardingPipeline.findUnique({
      where: { id: params.id },
      include: {
        site: {
          include: {
            customer: { select: { name: true } },
            partner: { select: { name: true } },
            region: { select: { name: true } },
          },
        },
        jobs: {
          orderBy: { createdAt: "desc" },
          include: {
            assignedTo: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: "OFFICER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!pipeline) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link
          href="/onboarding"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Onboarding
        </Link>
        <div className="flex items-start justify-between gap-4 mt-1">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy">
              {pipeline.site.name}
            </h1>
            <p className="text-sm text-slate-600">
              {pipeline.site.addressLine} · {pipeline.site.postcodeFormatted}
              {pipeline.site.region && ` · ${pipeline.site.region.name}`}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {pipeline.site.customer?.name ??
                pipeline.site.partner?.name ??
                "No customer/partner assigned yet"}
            </p>
          </div>
          <span className={STAGE_TONE[pipeline.stage]}>
            {STAGE_LABEL[pipeline.stage]}
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Program
          </div>
          <div className="font-medium text-brand-navy">
            {pipeline.program.charAt(0) +
              pipeline.program.slice(1).toLowerCase()}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Target go-live
          </div>
          <div className="font-medium text-brand-navy">
            {pipeline.targetGoLiveDate
              ? pipeline.targetGoLiveDate.toISOString().slice(0, 10)
              : "—"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Started
          </div>
          <div className="font-medium text-brand-navy">
            {pipeline.createdAt.toISOString().slice(0, 10)}
          </div>
        </div>
      </div>

      {pipeline.notes && (
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Notes
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {pipeline.notes}
          </p>
        </div>
      )}

      {pipeline.stage === "CANCELLED" && pipeline.cancelReason && (
        <div className="card p-4 border-red-200 bg-red-50/30">
          <div className="text-xs uppercase tracking-wider text-red-600 mb-1">
            Cancel reason
          </div>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">
            {pipeline.cancelReason}
          </p>
        </div>
      )}

      <StageAdvancer
        pipelineId={pipeline.id}
        currentStage={pipeline.stage}
      />

      <SetupJobs
        pipelineId={pipeline.id}
        currentStage={pipeline.stage}
        jobs={pipeline.jobs.map((j) => ({
          id: j.id,
          type: j.type,
          status: j.status,
          scheduledFor: j.scheduledFor,
          completedAt: j.completedAt,
          notes: j.notes,
          assignee: j.assignedTo?.name ?? null,
        }))}
        officers={officers}
      />
    </div>
  );
}
