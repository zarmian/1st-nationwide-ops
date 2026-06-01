"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseUkDateTimeLocal } from "@/lib/dates";
import {
  applyBillingToJob,
  applyPayToJob,
  billForSite,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";

const STAGES = [
  "PROPOSED",
  "SURVEY",
  "KEY_COLLECTION",
  "GO_LIVE",
  "CANCELLED",
] as const;

const PROGRAMS = ["TESCO", "SHURGARD", "OTHER"] as const;

const SETUP_JOB_TYPES = ["SURVEY", "KEY_COLLECTION"] as const;


const StartInput = z.object({
  siteId: z.string().uuid(),
  program: z.enum(PROGRAMS),
  targetGoLiveDate: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type StartResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function startOnboarding(
  input: z.infer<typeof StartInput>,
): Promise<StartResult> {
  await requireStaff();
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }
  const d = parsed.data;
  const existing = await prisma.onboardingPipeline.findFirst({
    where: {
      siteId: d.siteId,
      stage: { notIn: ["GO_LIVE", "CANCELLED"] },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: "This site already has an active onboarding pipeline.",
    };
  }
  const created = await prisma.onboardingPipeline.create({
    data: {
      siteId: d.siteId,
      program: d.program as any,
      stage: "PROPOSED",
      targetGoLiveDate: d.targetGoLiveDate ? new Date(d.targetGoLiveDate) : null,
      notes: d.notes || null,
    },
    select: { id: true },
  });
  revalidatePath("/onboarding");
  revalidatePath(`/sites/${d.siteId}`);
  return { ok: true, id: created.id };
}

const AdvanceInput = z.object({
  pipelineId: z.string().uuid(),
  toStage: z.enum(STAGES),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function advanceStage(
  input: z.infer<typeof AdvanceInput>,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = AdvanceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { pipelineId, toStage, notes } = parsed.data;

  const pipeline = await prisma.onboardingPipeline.findUnique({
    where: { id: pipelineId },
    select: { siteId: true, stage: true },
  });
  if (!pipeline) return { ok: false, error: "Pipeline not found." };

  const data: {
    stage: (typeof STAGES)[number];
    notes?: string | null;
    cancelReason?: string | null;
  } = { stage: toStage };
  if (notes !== undefined) data.notes = notes || null;
  if (toStage === "CANCELLED" && notes) data.cancelReason = notes;

  await prisma.onboardingPipeline.update({
    where: { id: pipelineId },
    data,
  });

  revalidatePath("/onboarding");
  revalidatePath(`/onboarding/${pipelineId}`);
  revalidatePath(`/sites/${pipeline.siteId}`);
  revalidatePath("/sites");
  return { ok: true };
}

const AddJobInput = z.object({
  pipelineId: z.string().uuid(),
  type: z.enum(SETUP_JOB_TYPES),
  scheduledFor: z.string().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function addSetupJob(
  input: z.infer<typeof AddJobInput>,
): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  await requireStaff();
  const parsed = AddJobInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const d = parsed.data;

  const pipeline = await prisma.onboardingPipeline.findUnique({
    where: { id: d.pipelineId },
    select: { siteId: true, site: { select: { customerId: true, partnerId: true } } },
  });
  if (!pipeline) return { ok: false, error: "Pipeline not found." };

  const job = await prisma.job.create({
    data: {
      type: d.type as any,
      source: "ONBOARDING" as any,
      status: d.assignedToUserId ? ("ASSIGNED" as any) : ("OPEN" as any),
      siteId: pipeline.siteId,
      customerId: pipeline.site.customerId,
      partnerId: pipeline.site.partnerId,
      onboardingPipelineId: d.pipelineId,
      assignedToUserId: d.assignedToUserId || null,
      scheduledFor: parseUkDateTimeLocal(d.scheduledFor),
      notes: d.notes || null,
    },
    select: { id: true },
  });

  // Snapshot the billable amount onto the job. Best-effort: PER_HOUR jobs
  // intentionally stay un-billed at creation (need actual duration on
  // completion). SURVEY and similar untyped flows return no_rate and
  // simply leave the snapshot empty.
  const rateService = jobTypeToRateService(d.type);
  if (rateService) {
    const bill = await billForSite(pipeline.siteId, rateService);
    if (bill.ok) await applyBillingToJob(job.id, bill);
    if (d.assignedToUserId) {
      const pay = await payForOfficer(d.assignedToUserId, rateService);
      if (pay.ok) await applyPayToJob(job.id, pay);
    }
  }

  revalidatePath(`/onboarding/${d.pipelineId}`);
  return { ok: true, jobId: job.id };
}

export async function closeSetupJob(
  jobId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { onboardingPipelineId: true },
  });
  if (!job) return { ok: false, error: "Job not found." };
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "CLOSED" as any, completedAt: new Date() },
  });
  if (job.onboardingPipelineId) {
    revalidatePath(`/onboarding/${job.onboardingPipelineId}`);
  }
  return { ok: true };
}
