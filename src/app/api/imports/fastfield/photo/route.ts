import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

/**
 * Photo upload for the FastField import. The robot downloads each photo and
 * signature from FastField (shrunk to at most 1600 px) and sends the bytes
 * here one at a time; we store them under uploads/fastfield/ — the same
 * 180-day retention as officers' own report photos — and return the URL it
 * then puts in the report.
 *
 * Auth:  Authorization: Bearer <NEXUS_IMPORT_SECRET>. Fail-closed.
 * Query: ?submission=<FastField submission id>&name=<file name>
 * Body:  the image bytes, Content-Type image/jpeg | image/png | image/webp.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // under the 4.5 MB request limit
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function authorised(req: Request): boolean {
  const secret = process.env.NEXUS_IMPORT_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization");
  const alt = req.headers.get("x-import-secret");
  return bearer === `Bearer ${secret}` || alt === secret;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const url = new URL(req.url);
  const submission = safe(url.searchParams.get("submission") ?? "");
  const name = safe((url.searchParams.get("name") ?? "photo").replace(/\.[a-z0-9]+$/i, ""));
  if (!submission) {
    return NextResponse.json({ error: "submission is required" }, { status: 400 });
  }
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[contentType];
  if (!ext) {
    return NextResponse.json({ error: "Only JPEG, PNG or WebP images" }, { status: 415 });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty image" }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  try {
    const blob = await put(`uploads/fastfield/${submission}/${name}.${ext}`, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });
    return NextResponse.json({ ok: true, url: blob.url });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Upload failed" },
      { status: 500 },
    );
  }
}
