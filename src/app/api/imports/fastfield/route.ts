import { NextResponse } from "next/server";
import { z } from "zod";
import {
  importFastField,
  planFastField,
  retryUnmatched,
} from "@/lib/fastfieldImport";
import type { FastFieldIncoming } from "@/lib/fastfield";
import { errorCode, keepOurMedia } from "@/lib/fastfieldIntake";
import { recordRefusedReports, REFUSED_REASONS } from "@/lib/fastfieldRefused";

/**
 * Machine ingest for FastField reports. The robot (scripts/fastfield-forms.mjs,
 * GitHub Actions) logs into the FastField portal, lists submissions for a date
 * window and calls this in these steps:
 *
 *   { action: "plan", forms, submissions }  → which submissions are new and on
 *   { action: "import", reports }           → attach each to its activity
 *   { action: "refused", reports }          → keep the ones "import" refused
 *   { action: "retry" }                     → re-try the waiting reports most likely to match now
 *
 * Photos are uploaded first, one at a time, to ./photo — reports carry URLs,
 * and only addresses on our own Blob store are kept (lib/fastfieldIntake).
 * A report "import" refuses — too big (413) or with something it can't read
 * (400, code invalid_report) — comes back as "refused": its id, form, send
 * time and a reason, no answers. It's kept set aside with a note
 * (lib/fastfieldRefused), so the office sees it and "plan" stops returning it.
 * A preview run passes `run` (an id for the run) so each form's counts are
 * kept for Admin → FastField. See lib/fastfieldImport for the matching.
 *
 * Errors carry a short `code`, never an error's message (it can quote a
 * report), and only codes are logged.
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

const Report = z.object({
  submissionId: Id,
  formId: FormId,
  formName: z.string().max(300),
  submittedAt: z.string().max(40),
  startedAt: When,
  finishedAt: When,
  submittedBy: z.string().max(200).nullable().optional(),
  answers: z.array(Answer).max(500),
  // Checked one by one below: an address that isn't on our storage is
  // dropped, not a reason to refuse the whole report.
  photoUrls: z.array(z.unknown()).max(200).optional(),
  signatureUrl: z.unknown().optional(),
});

const Import = z.object({
  action: z.literal("import"),
  run: Run,
  reports: z.array(Report).max(25),
});

const Refused = z.object({
  action: z.literal("refused"),
  reports: z
    .array(
      z.object({
        submissionId: Id,
        formId: FormId,
        submittedAt: When,
        submittedBy: z.string().max(200).nullable().optional(),
        reason: z.enum(REFUSED_REASONS),
      }),
    )
    .min(1)
    .max(25),
});

const Retry = z.object({ action: z.literal("retry") });

const Body = z.discriminatedUnion("action", [Plan, Import, Refused, Retry]);

export async function GET() {
  return NextResponse.json({ ok: true, service: "fastfield", method: "POST" });
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised", code: "unauthorised" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    // Every problem is inside the reports of an import (not the request
    // around them): the robot keeps such a report as refused instead of
    // sending it again every run. `fields` names where, never the values.
    const inReports =
      (raw as { action?: unknown } | null)?.action === "import" &&
      issues.every((i) => i.path[0] === "reports" && typeof i.path[1] === "number");
    return NextResponse.json(
      {
        error: "Invalid body",
        code: inReports ? "invalid_report" : "invalid_body",
        fields: issues.slice(0, 5).map((i) => i.path.join(".") || "body"),
      },
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
        return NextResponse.json(
          { error: "A report is too large", code: "report_too_big" },
          { status: 413 },
        );
      }
      // Photos and signatures must be https addresses on Vercel Blob's public
      // storage, under uploads/fastfield/ (where the photo route puts them);
      // anything else is left out. Deliberately not pinned to our own store's
      // host: if working that out from the token were ever wrong, every new
      // photo would be dropped. The photo route warns if the two disagree.
      let photosDropped = 0;
      const reports = body.reports.map((r) => {
        const { dropped, ...media } = keepOurMedia(r, null);
        photosDropped += dropped;
        return { ...r, ...media };
      });
      if (photosDropped) {
        console.warn("FastField import: photo addresses not on our storage, left out:", photosDropped);
      }
      const summary = await importFastField(reports as FastFieldIncoming[], preview, body.run);
      return NextResponse.json({ ok: true, preview, ...summary, photosDropped });
    }
    if (body.action === "refused") {
      if (preview) {
        return NextResponse.json({ ok: true, preview, recorded: 0, skipped: "refused reports aren't kept in a preview" });
      }
      const summary = await recordRefusedReports(body.reports);
      return NextResponse.json({ ok: true, preview, ...summary });
    }
    if (preview) {
      return NextResponse.json({ ok: true, preview, skipped: "retry is not previewed" });
    }
    const summary = await retryUnmatched({ budgetMs: 45_000 });
    return NextResponse.json({ ok: true, preview, ...summary });
  } catch (e) {
    const code = errorCode(e);
    console.error("FastField import route failed:", body.action, code);
    return NextResponse.json({ ok: false, error: "Import failed", code }, { status: 500 });
  }
}
