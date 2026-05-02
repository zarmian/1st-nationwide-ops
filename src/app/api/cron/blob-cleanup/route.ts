import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { isAuthorisedCron } from "@/lib/cronAuth";

/**
 * 180-day retention sweep over uploaded media in Vercel Blob.
 *
 * We list everything under the `uploads/` prefix and delete blobs whose
 * `uploadedAt` is older than the cutoff. Submissions that referenced those
 * blobs keep the dead URL in their payload — the admin will see a broken
 * image, which is intentional (signal that the media has been retired).
 *
 * Runs daily at 03:00 UTC; configured in vercel.json.
 */

const RETENTION_DAYS = 180;

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  const toDelete: string[] = [];

  do {
    const page = await list({
      prefix: "uploads/",
      cursor,
      limit: 1000,
    });
    for (const b of page.blobs) {
      scanned++;
      if (b.uploadedAt < cutoff) {
        toDelete.push(b.url);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  // del() supports up to 1000 URLs per call — chunk just in case.
  for (let i = 0; i < toDelete.length; i += 1000) {
    const chunk = toDelete.slice(i, i + 1000);
    if (chunk.length === 0) break;
    await del(chunk);
    deleted += chunk.length;
  }

  return NextResponse.json({
    ok: true,
    retentionDays: RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
    scanned,
    deleted,
  });
}
