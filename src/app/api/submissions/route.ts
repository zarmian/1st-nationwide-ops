import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFields, validatePayload } from "@/lib/formTemplates";

const Body = z.object({
  siteId: z.string().min(1),
  jobId: z.string().nullable().optional(),
  patrolVisitId: z.string().uuid().nullable().optional(),
  form: z.enum([
    "ALARM_RESPONSE",
    "PATROL",
    "LOCK",
    "UNLOCK",
    "KEY_COLLECTION",
    "KEY_DROPOFF",
    "VPI",
    "ADHOC",
  ]),
  formTemplateId: z.string().uuid().nullable().optional(),
  officerNameRaw: z.string().min(1).max(120),
  arrivedAt: z.string().datetime().nullable().optional(),
  departedAt: z.string().datetime().nullable().optional(),
  payload: z.record(z.any()).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
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
      submittedByUserId: session ? ((session.user as any).id as string) : null,
      officerNameRaw: data.officerNameRaw,
      arrivedAt: data.arrivedAt ? new Date(data.arrivedAt) : null,
      departedAt: data.departedAt ? new Date(data.departedAt) : null,
      payload: payload as any,
    },
    select: { id: true },
  });

  await prisma.reportReview.create({
    data: {
      submissionId: submitted.id,
      status: "PENDING",
    },
  });

  // If this submission completes a patrol visit, mark it COMPLETED with the
  // departure time (or now). arrivedAt is only set from the form when the
  // visit doesn't already have one — preserves the real "on-site" tap time.
  if (data.patrolVisitId) {
    const visit = await prisma.patrolVisit.findUnique({
      where: { id: data.patrolVisitId },
      select: { arrivedAt: true },
    });
    const departed = data.departedAt ? new Date(data.departedAt) : new Date();
    await prisma.patrolVisit.update({
      where: { id: data.patrolVisitId },
      data: {
        status: "COMPLETED",
        departedAt: departed,
        arrivedAt:
          visit?.arrivedAt ??
          (data.arrivedAt ? new Date(data.arrivedAt) : new Date()),
      },
    });
  }

  return NextResponse.json({ ok: true, id: submitted.id });
}
