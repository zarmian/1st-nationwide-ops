import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { prisma } from "@/lib/db";

/**
 * Issues a short-lived Vercel Blob upload token for a single file. The client
 * never sees the BLOB_READ_WRITE_TOKEN — instead it calls `upload()` from
 * `@vercel/blob/client`, which POSTs here and gets back a scoped token.
 *
 * Anonymous uploads are allowed (the /submit page is public), but only after
 * we've validated:
 *   - the targeted siteId exists and is active
 *   - the content type is image/png|jpeg|webp (or signature pngs)
 *   - the file is under MAX_FILE_BYTES
 *
 * The pathname coming from the client must start with `uploads/` to keep all
 * user-generated content in one prefix that the retention cron can sweep.
 */

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        if (!pathname.startsWith("uploads/")) {
          throw new Error("Pathname must start with uploads/");
        }

        let clientPayload: { siteId?: string } | null = null;
        if (clientPayloadRaw) {
          try {
            clientPayload = JSON.parse(clientPayloadRaw);
          } catch {
            throw new Error("Invalid client payload");
          }
        }
        const siteId = clientPayload?.siteId;
        if (!siteId) {
          throw new Error("siteId is required");
        }
        const site = await prisma.site.findFirst({
          where: { id: siteId, active: true },
          select: { id: true },
        });
        if (!site) {
          throw new Error("Unknown site");
        }

        return {
          allowedContentTypes: [
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/webp",
            "image/heic",
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_FILE_BYTES,
          tokenPayload: JSON.stringify({ siteId }),
        };
      },
      onUploadCompleted: async () => {
        // No DB bookkeeping needed — URLs land in the FormSubmission payload
        // when the form is submitted. Orphans get swept by the retention cron.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Upload token failed" },
      { status: 400 },
    );
  }
}
