import { NextResponse } from "next/server";
import { z } from "zod";
import {
  importFastField,
  planFastField,
  retryUnmatched,
} from "@/lib/fastfieldImport";
import type { FastFieldIncoming } from "@/lib/fastfield";

/**
 * Machine ingest for FastField reports. The robot (scripts/fastfield-forms.mjs,
 * GitHub Actions) logs into the FastField portal, lists submissions for a date
 * window and calls this in three steps:
 *
 *   { action: "plan", forms, submissions }  → which submissions are new and on
 *   { action: "import", reports }           → attach each to its activity
 *   { action: "retry" }                     → re-try recent unmatched reports
 *
 * Photos are uploaded first, one at a time, to ./photo — reports carry URLs.
 * A preview run passes `run` (an id for the run) so each form's counts are
 * kept for Admin → FastField. See lib/fastfieldImport for the matching.
 *
 * Auth:  Authorization: Bearer <NEXUS_IMPORT_SECRET> (or x-import-secret) —
 *        the same secret as the other imports. Fail-closed.
 * Query: ?preview=1 reports what WOULD happen; only the form list and the
 *        forms' preview counts are saved.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.NEXUS_IMPORT_SECRET;
  if (!secret) return false; // fail closed until configured
  const bearer = req.headers.get("authorization");
  const alt = req.headers.get("x-import-secret");
  return bearer === `Bearer ${secret}` || alt === secret;
}

const Id = z.string().trim().min(1).max(100);
const FormId = z.number().int().positive();
const When = z.string().max(40).nullable().optional();

const Run = z.string().trim().min(1).max(64).optional();

const Plan = z.object({
  action: z.literal("plan"),
  run: Run,
  forms: z.array(z.object({ formId: FormId, name: z.string().max(300) })).max(500),
  submissions: z
    .array(
      z.object({
        submissionId: Id,
        formId: FormId.nullable().optional(),
        formName: z.string().max(300).nullable().optional(),
      }),
    )
    .max(20000),
});

const Answer = z.object({
  key: z.string().max(100),
  label: z.string().max(1000),
  type: z.string().max(60),
  value: z.unknown(),
  at: When,
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

const HttpsUrl = z.string().url().max(1000).startsWith("https://");

const Report = z.object({
  submissionId: Id,
  formId: FormId,
  formName: z.string().max(300),
  submittedAt: z.string().max(40),
  startedAt: When,
  finishedAt: When,
  submittedBy: z.string().max(200).nullable().optional(),
  answers: z.array(Answer).max(500),
  photoUrls: z.array(HttpsUrl).max(200).optional(),
  signatureUrl: HttpsUrl.nullable().optional(),
});

const Import = z.object({
  action: z.literal("import"),
  run: Run,
  reports: z.array(Report).max(25),
});

const Retry = z.object({ action: z.literal("retry") });

const Body = z.discriminatedUnion("action", [Plan, Import, Retry]);

export async function GET() {
  return NextResponse.json({ ok: true, service: "fastfield", method: "POST" });
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const preview = new URL(req.url).searchParams.get("preview") === "1";

  try {
    if (body.action === "plan") {
      const result = await planFastField(body, preview, body.run);
      return NextResponse.json({ ok: true, preview, ...result });
    }
    if (body.action === "import") {
      // A report's answers must fit comfortably in one database row.
      const tooBig = body.reports.find((r) => JSON.stringify(r.answers).length > 500_000);
      if (tooBig) {
        return NextResponse.json({ error: "A report is too large" }, { status: 413 });
      }
      const summary = await importFastField(body.reports as FastFieldIncoming[], preview, body.run);
      return NextResponse.json({ ok: true, preview, ...summary });
    }
    if (preview) {
      return NextResponse.json({ ok: true, preview, skipped: "retry is not previewed" });
    }
    const summary = await retryUnmatched();
    return NextResponse.json({ ok: true, preview, ...summary });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Import failed" },
      { status: 500 },
    );
  }
}
