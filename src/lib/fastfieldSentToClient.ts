import { prisma } from "@/lib/db";

/**
 * Whether a FastField report attached to an activity has already gone to the
 * client, and how. The robot never moves or takes off such a report on its
 * own; a person still can, and is told it was already sent.
 *
 * For now this only counts client reports sent from the report's review.
 * TODO(review-fixes): also count the daily client email that covered it.
 */
export async function sentToClient(report: {
  id: string;
  formSubmissionId: string | null;
}): Promise<{ sent: boolean; how?: string }> {
  if (!report.formSubmissionId) return { sent: false };
  const n = await prisma.clientReport.count({
    where: { review: { submissionId: report.formSubmissionId } },
  });
  return n > 0 ? { sent: true, how: "in a client report" } : { sent: false };
}
