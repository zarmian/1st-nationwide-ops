"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkLimit, submissionLimiter } from "@/lib/ratelimit";

/**
 * Public claim flow for outside officers.
 *
 * Records the claim on the Job using existing fields:
 *   responderType    = EXTERNAL_NAMED
 *   externalResponder = officer name (free text)
 *   status            = ASSIGNED
 *
 * The page is intentionally public — anyone with the link can claim.
 * That mirrors the existing /submit policy. Abuse is bounded by the
 * shared submissionLimiter (30/min per IP). The DB update is atomic
 * (WHERE status=OPEN AND externalResponder IS NULL AND
 * assignedToUserId IS NULL) so simultaneous claims race-safely; only
 * the first wins, the others get the "already claimed" message.
 */
const ClaimBody = z.object({
  jobId: z.string().uuid(),
  officerName: z.string().trim().min(2).max(120),
});

export type ClaimResult =
  | { ok: false; error: string }
  | { ok: true; redirectTo: string };

export async function claimJob(input: unknown): Promise<ClaimResult> {
  const parsed = ClaimBody.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please enter your full name." };
  }
  const { jobId, officerName } = parsed.data;

  const hdrs = headers();
  const fwd = hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip");
  const ipKey = fwd ? fwd.split(",")[0]!.trim() : "anon";
  const limit = await checkLimit(submissionLimiter, `claim:${ipKey}`);
  if (!limit.allowed) {
    return {
      ok: false,
      error: `Too many attempts — try again in ${limit.retryAfterSeconds}s.`,
    };
  }

  const result = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: "OPEN",
      assignedToUserId: null,
      externalResponder: null,
    },
    data: {
      status: "ASSIGNED",
      responderType: "EXTERNAL_NAMED",
      externalResponder: officerName,
    },
  });

  if (result.count === 0) {
    return {
      ok: false,
      error: "This job has already been claimed by someone else.",
    };
  }

  redirect(
    `/submit?jobId=${jobId}&officerName=${encodeURIComponent(officerName)}`,
  );
}
