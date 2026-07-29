/**
 * Shared job state transitions — reassign / cancel / close — with no auth or
 * revalidation of their own. The dispatch + patrols server actions wrap these
 * (adding requireStaff + revalidatePath), and the Telegram webhook calls them
 * directly after checking the linked user is staff. Keeping the state + money
 * logic in one place stops the UI and the bot from drifting apart.
 */
import { prisma } from "@/lib/db";
import { snapshotJobFinanceIfNeeded } from "@/lib/billing";
import { notifyAssignedOfficerOfJob } from "@/lib/telegramNotify";

export type JobActionResult = {
  ok: boolean;
  error?: string;
  siteId?: string | null;
};

/**
 * Reassign a job to an officer (or null to unassign). Only flips the
 * OPEN/ASSIGNED status pre-start — never overwrites IN_PROGRESS or later.
 * Pings the new assignee on Telegram if they've linked it.
 */
export async function reassignJobCore(
  jobId: string,
  officerId: string | null,
): Promise<JobActionResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true, siteId: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  const isPreStart = job.status === "OPEN" || job.status === "ASSIGNED";
  await prisma.job.update({
    where: { id: jobId },
    data: {
      assignedToUserId: officerId,
      ...(isPreStart && {
        status: officerId ? ("ASSIGNED" as any) : ("OPEN" as any),
      }),
    },
  });
  if (officerId) {
    notifyAssignedOfficerOfJob(jobId).catch((e) =>
      console.error("notifyAssignedOfficerOfJob failed", e),
    );
  }
  return { ok: true, siteId: job.siteId };
}

/**
 * Cancel a job — flips to CANCELLED and reverses the billing + pay snapshot
 * (customer isn't billed, officer isn't paid). Records who + when for audit;
 * Restore re-runs the rate lookup. Closed jobs can't be cancelled.
 */
export async function cancelJobCore(
  jobId: string,
  byUserId: string,
): Promise<JobActionResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, siteId: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status === "CANCELLED") return { ok: true, siteId: job.siteId };
  if (job.status === "CLOSED" || job.status === "SENT_TO_CLIENT") {
    return { ok: false, error: "This job is already closed — can't cancel." };
  }
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "CANCELLED" as any,
      cancelledAt: new Date(),
      cancelledByUserId: byUserId,
      statusBeforeCancel: job.status as any,
      billedAmount: null,
      billedCurrency: null,
      billedAt: null,
      paidAmount: null,
      paidCurrency: null,
      paidAt: null,
    },
  });
  return { ok: true, siteId: job.siteId };
}

/**
 * Close a job on the officer's behalf — the same terminal state (APPROVED)
 * the dispatcher "close" uses. Stamps start/finish if missing, appends an
 * audit note, and fills the billing + pay snapshot. Already-closed = no-op.
 */
export async function closeJobCore(
  jobId: string,
  opts?: { closedAt?: Date | null; note?: string | null },
): Promise<JobActionResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      siteId: true,
      startedAt: true,
      completedAt: true,
      notes: true,
    },
  });
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "CANCELLED") {
    return { ok: false, error: "Cancelled jobs can't be closed — restore first." };
  }
  if (
    job.status === "APPROVED" ||
    job.status === "SENT_TO_CLIENT" ||
    job.status === "CLOSED"
  ) {
    return { ok: true, siteId: job.siteId };
  }

  const closedAt = opts?.closedAt ?? new Date();
  const mergedNotes = opts?.note
    ? job.notes
      ? `${job.notes}\n${opts.note}`
      : opts.note
    : job.notes;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "APPROVED" as any,
      startedAt: job.startedAt ?? closedAt,
      completedAt: job.completedAt ?? closedAt,
      notes: mergedNotes,
    },
  });
  // Fill billing + officer pay (no-op if already set); stamps the accounting
  // month from the scheduled date, else completion.
  await snapshotJobFinanceIfNeeded(jobId).catch((e) =>
    console.error("snapshotJobFinanceIfNeeded (close) failed", e),
  );
  return { ok: true, siteId: job.siteId };
}
