"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const EditsInput = z.object({
  officerNameRaw: z.string().trim().min(1).max(120).optional(),
  arrivedAt: z.string().trim().optional(),
  departedAt: z.string().trim().optional(),
  reviewerNotes: z.string().trim().max(2000).optional(),
});

export type ReviewActionState = { error?: string };

async function requireReviewer() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    throw new Error("Not authorised");
  }
  return (session?.user as any)?.id as string;
}

function parseDateTimeLocal(v: string | undefined): Date | null | undefined {
  if (v === undefined) return undefined; // not submitted = leave alone
  if (v === "") return null; // explicitly cleared
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function buildEdits(
  before: {
    officerNameRaw: string;
    arrivedAt: Date | null;
    departedAt: Date | null;
  },
  after: {
    officerNameRaw: string;
    arrivedAt: Date | null;
    departedAt: Date | null;
  },
) {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (before.officerNameRaw !== after.officerNameRaw) {
    diff.officerNameRaw = { from: before.officerNameRaw, to: after.officerNameRaw };
  }
  const ba = before.arrivedAt?.toISOString() ?? null;
  const aa = after.arrivedAt?.toISOString() ?? null;
  if (ba !== aa) diff.arrivedAt = { from: ba, to: aa };
  const bd = before.departedAt?.toISOString() ?? null;
  const ad = after.departedAt?.toISOString() ?? null;
  if (bd !== ad) diff.departedAt = { from: bd, to: ad };
  return diff;
}

export async function approveReview(
  reviewId: string,
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const reviewerId = await requireReviewer();
  const parsed = EditsInput.safeParse({
    officerNameRaw: formData.get("officerNameRaw")?.toString(),
    arrivedAt: formData.get("arrivedAt")?.toString(),
    departedAt: formData.get("departedAt")?.toString(),
    reviewerNotes: formData.get("reviewerNotes")?.toString(),
  });
  if (!parsed.success) {
    return { error: "Invalid input." };
  }

  const review = await prisma.reportReview.findUnique({
    where: { id: reviewId },
    include: {
      submission: {
        include: {
          job: {
            include: {
              customer: { select: { id: true, name: true, contactEmail: true } },
            },
          },
        },
      },
    },
  });
  if (!review) return { error: "Review not found." };

  const sub = review.submission;
  const newOfficer = parsed.data.officerNameRaw ?? sub.officerNameRaw;
  const newArrived = parseDateTimeLocal(parsed.data.arrivedAt);
  const newDeparted = parseDateTimeLocal(parsed.data.departedAt);

  const after = {
    officerNameRaw: newOfficer,
    arrivedAt: newArrived === undefined ? sub.arrivedAt : newArrived,
    departedAt: newDeparted === undefined ? sub.departedAt : newDeparted,
  };
  const before = {
    officerNameRaw: sub.officerNameRaw,
    arrivedAt: sub.arrivedAt,
    departedAt: sub.departedAt,
  };
  const edits = buildEdits(before, after);
  const wasEdited = Object.keys(edits).length > 0;

  await prisma.$transaction(async (tx) => {
    if (wasEdited) {
      await tx.formSubmission.update({
        where: { id: sub.id },
        data: {
          officerNameRaw: after.officerNameRaw,
          arrivedAt: after.arrivedAt,
          departedAt: after.departedAt,
        },
      });
    }
    await tx.reportReview.update({
      where: { id: reviewId },
      data: {
        status: wasEdited ? "EDITED_AND_APPROVED" : "APPROVED",
        reviewerId,
        reviewedAt: new Date(),
        reviewerNotes: parsed.data.reviewerNotes || null,
        edits: wasEdited ? (edits as any) : undefined,
      },
    });

    // Create a pending ClientReport only for customer-facing jobs.
    const job = sub.job;
    const eligible =
      job &&
      !job.reportedViaPartnerApp &&
      job.customer &&
      job.customer.contactEmail;
    if (eligible) {
      const subject = `${job!.customer!.name} — site visit report (${sub.form
        .replace(/_/g, " ")
        .toLowerCase()})`;
      await tx.clientReport.create({
        data: {
          reviewId,
          channel: "EMAIL",
          toAddress: job!.customer!.contactEmail!,
          subject,
          status: "PENDING",
        },
      });
    }
  });

  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/${reviewId}`);
  redirect("/admin/reports");
}

export async function rejectReview(
  reviewId: string,
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const reviewerId = await requireReviewer();
  const notes = formData.get("reviewerNotes")?.toString().trim() ?? "";
  if (notes.length < 3) {
    return { error: "Please add a short reason for rejection." };
  }

  await prisma.reportReview.update({
    where: { id: reviewId },
    data: {
      status: "REJECTED",
      reviewerId,
      reviewedAt: new Date(),
      reviewerNotes: notes,
    },
  });

  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/${reviewId}`);
  redirect("/admin/reports");
}
