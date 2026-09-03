/**
 * Server-side image fetch for the client PDF. Officer photos live in Vercel
 * Blob as public URLs; @react-pdf can only embed JPEG/PNG, so we fetch each
 * candidate, sniff its real bytes, and hand back a data URI only for
 * genuinely-supported images. Anything else (webp, HEIC, an HTML error page,
 * a timeout) returns null and is simply left out — the report never breaks on
 * a bad image.
 */

const TIMEOUT_MS = 6000;
const MAX_BYTES = 6 * 1024 * 1024; // skip anything huge — keeps the PDF light

function sniffMime(b: Uint8Array): "image/jpeg" | "image/png" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}

export async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    const mime = sniffMime(buf);
    if (!mime) return null;
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Resolve many image URLs to data URIs in parallel, dropping the ones that
 * fail. Order is preserved; the result is only the successful ones.
 */
export async function fetchImages(urls: string[]): Promise<string[]> {
  const settled = await Promise.all(urls.map((u) => fetchImageAsDataUri(u)));
  return settled.filter((x): x is string => x !== null);
}
