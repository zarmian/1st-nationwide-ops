import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const Body = z.object({
  siteId: z.string().min(1),
  jobId: z.string().nullable().optional(),
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

  // Verify site exists & active
  const site = await prisma.site.findFirst({
    where: { id: data.siteId, active: true },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const submitted = await prisma.formSubmission.create({
    data: {
      form: data.form as any,
      siteId: data.siteId,
      jobId: data.jobId ?? null,
      submittedByUserId: session ? ((session.user as any).id as string) : null,
      officerNameRaw: data.officerNameRaw,
      arrivedAt: data.arrivedAt ? new Date(data.arrivedAt) : null,
      departedAt: data.departedAt ? new Date(data.departedAt) : null,
      payload: (data.payload ?? {}) as any,
    },
    select: { id: true },
  });

  // Auto-create a review queue row
  await prisma.reportReview.create({
    data: {
      submissionId: submitted.id,
      status: "PENDING",
    },
  });

  return NextResponse.json({ ok: true, id: submitted.id });
}
