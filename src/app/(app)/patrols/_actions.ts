"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";

const ReassignInput = z.object({
  scheduleId: z.string().uuid(),
  officerId: z.string().uuid().or(z.literal("")).nullable(),
});

export async function reassignSchedule(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = ReassignInput.safeParse({
    scheduleId: formData.get("scheduleId")?.toString() ?? "",
    officerId: formData.get("officerId")?.toString() ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const officerId =
    parsed.data.officerId && parsed.data.officerId !== ""
      ? parsed.data.officerId
      : null;
  await prisma.patrolSchedule.update({
    where: { id: parsed.data.scheduleId },
    data: { assignedOfficerId: officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function toggleScheduleActive(
  scheduleId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  await requireStaff();
  await prisma.patrolSchedule.update({
    where: { id: scheduleId },
    data: { active },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function reassignVisit(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const visitId = formData.get("visitId")?.toString();
  const officerId = formData.get("officerId")?.toString() || "";
  if (!visitId) return { ok: false, error: "Missing visit id" };
  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: { officerId: officerId === "" ? null : officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function reassignLockUnlockSchedule(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = ReassignInput.safeParse({
    scheduleId: formData.get("scheduleId")?.toString() ?? "",
    officerId: formData.get("officerId")?.toString() ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const officerId =
    parsed.data.officerId && parsed.data.officerId !== ""
      ? parsed.data.officerId
      : null;
  await prisma.lockUnlockSchedule.update({
    where: { id: parsed.data.scheduleId },
    data: { assignedOfficerId: officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function reassignJob(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const jobId = formData.get("jobId")?.toString();
  const officerId = formData.get("officerId")?.toString() || "";
  if (!jobId) return { ok: false, error: "Missing job id" };
  const nextOfficer = officerId === "" ? null : officerId;

  // Only flip the OPEN/ASSIGNED status when the job is still pre-start —
  // never overwrite IN_PROGRESS / SUBMITTED / REVIEW_PENDING / closed.
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  const isPreStart = job.status === "OPEN" || job.status === "ASSIGNED";
  await prisma.job.update({
    where: { id: jobId },
    data: {
      assignedToUserId: nextOfficer,
      ...(isPreStart && {
        status: nextOfficer ? ("ASSIGNED" as any) : ("OPEN" as any),
      }),
    },
  });
  revalidatePath("/patrols");
  revalidatePath("/dispatch");
  return { ok: true };
}
