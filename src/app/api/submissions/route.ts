import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFields, validatePayload } from "@/lib/formTemplates";
import { notifyVisitCompleted } from "@/lib/notifications";
import {
  checkLimit,
  clientKey,
  submissionLimiter,
} from "@/lib/ratelimit";
import {
  applyBillingToVisit,
  applyPayToVisit,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";

const Body = z.object({
  siteId: z.string().min(1),
  jobId: z.string().nullable().optional(),
  patrolVisitId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  form: z.enum([
    "ALARM_RESPONSE",
    "PATROL",
    "LOCK",
    "UNLOCK",
    "KEY_COLLECTION",
    "KEY_DROPOFF",
    "VPI",
    "ADHOC",
    "SHIFT_CHECK",
  ]),
  formTemplateId: z.string().uuid().nullable().optional(),
  officerNameRaw: z.string().min(1).max(120),
  arrivedAt: z.string().datetime().nullable().optional(),
  departedAt: z.string().datetime().nullable().optional(),
  payload: z.record(z.any()).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  // /submit is intentionally public — gate abuse here.
  if (!session) {
    const limit = await checkLimit(submissionLimiter, clientKey(req));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: `Too many submissions — try again in ${limit.retryAfterSeconds}s` },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid form data", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const site = await prisma.site.findFirst({
    where: { id: data.siteId, active: true },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  let payload: Record<string, unknown> = data.payload ?? {};
  let formTemplateId: string | null = data.formTemplateId ?? null;

  if (formTemplateId) {
    const template = await prisma.formTemplate.findUnique({
      where: { id: formTemplateId },
      select: { active: true, jobType: true, fields: true },
    });
    if (!template || !template.active) {
      return NextResponse.json(
        { error: "Form template not found or inactive" },
        { status: 400 },
      );
    }
    if (template.jobType !== null && template.jobType !== data.form) {
      return NextResponse.json(
        { error: "Form template does not match job type" },
        { status: 400 },
      );
    }
    const fields = parseFields(template.fields);
    const result = validatePayload(fields, payload);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Please fix the errors below.", fieldErrors: result.errors },
        { status: 400 },
      );
    }
    payload = result.payload;
  }

  const submitted = await prisma.formSubmission.create({
    data: {
      form: data.form as any,
      formTemplateId,
      siteId: data.siteId,
      jobId: data.jobId ?? null,
      patrolVisitId: data.patrolVisitId ?? null,
      shiftId: data.shiftId ?? null,
      submittedByUserId: session ? (session.user.id) : null,
      officerNameRaw: data.officerNameRaw,
      arrivedAt: data.arrivedAt ? new Date(data.arrivedAt) : null,
      departedAt: data.departedAt ? new Date(data.departedAt) : null,
      payload: payload as any,
    },
    select: { id: true },
  });

  // Routine scheduled activities auto-approve. They're not the customer-
  // facing reports that need admin sign-off (that's ALARM_RESPONSE +
  // ad-hoc submissions); they're just the officer confirming the
  // scheduled task happened. Skipping the review queue keeps the queue
  // focused on what actually needs reading.
  const autoApprove =
    data.form === "PATROL" ||
    data.form === "VPI" ||
    data.form === "LOCK" ||
    data.form === "UNLOCK";
  await prisma.reportReview.create({
    data: {
      submissionId: submitted.id,
      status: autoApprove ? "APPROVED" : "PENDING",
      reviewedAt: autoApprove ? new Date() : null,
    },
  });

  // The officer has finished the report — move the Job out of the "live"
  // dispatch view. For auto-approved forms we skip SUBMITTED entirely
  // and go straight to APPROVED so dispatch + review queue stay clean.
  if (data.jobId) {
    await prisma.job.updateMany({
      where: {
        id: data.jobId,
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
      },
      data: {
        status: autoApprove ? "APPROVED" : "SUBMITTED",
      },
    });
  }

  // If this submission completes a patrol visit, mark it COMPLETED with the
  // departure time (or now). arrivedAt is only set from the form when the
  // visit doesn't already have one — preserves the real "on-site" tap time.
  if (data.patrolVisitId) {
    const visit = await prisma.patrolVisit.findUnique({
      where: { id: data.patrolVisitId },
      select: {
        arrivedAt: true,
        status: true,
        siteId: true,
        officerId: true,
      },
    });
    const departed = data.departedAt ? new Date(data.departedAt) : new Date();
    const arrived =
      visit?.arrivedAt ??
      (data.arrivedAt ? new Date(data.arrivedAt) : new Date());
    await prisma.patrolVisit.update({
      where: { id: data.patrolVisitId },
      data: {
        status: "COMPLETED",
        departedAt: departed,
        arrivedAt: arrived,
      },
    });
    if (visit?.status !== "COMPLETED") {
      notifyVisitCompleted(data.patrolVisitId).catch((e) =>
        console.error("notifyVisitCompleted failed", e),
      );
    }
    // Snapshot billing onto the visit. We map the SubmissionForm value back
    // to a RateService — same lookup as for jobs, just from a different
    // source. Best-effort: a missing rate leaves the visit unbilled rather
    // than failing the submission.
    if (visit?.siteId) {
      const rateService = jobTypeToRateService(data.form);
      const duration = durationMinutes(arrived, departed);
      if (rateService) {
        const billResult = await billForSite(
          visit.siteId,
          rateService,
          duration,
        );
        await applyBillingToVisit(data.patrolVisitId, billResult);

        // Officer pay snapshot — only meaningful when we know who attended.
        const attendingOfficerId =
          visit.officerId ??
          (session ? session.user.id : null);
        if (attendingOfficerId) {
          const payResult = await payForOfficer(
            attendingOfficerId,
            rateService,
            duration,
          );
          await applyPayToVisit(data.patrolVisitId, payResult);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, id: submitted.id });
}
