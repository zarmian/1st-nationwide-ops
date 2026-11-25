/**
 * Checks at the door for what the FastField robot (scripts/fastfield-forms.mjs)
 * sends to /api/imports/fastfield and /api/imports/fastfield/photo.
 *
 * Photos and signatures: the robot copies each one to our own Vercel Blob
 * store through the photo route, which hands back its public address,
 * https://<store>.public.blob.vercel-storage.com/uploads/fastfield/…. The
 * import keeps only such addresses and drops anything else (keepOurMedia);
 * the answers view also puts only http(s) addresses in a link or an image
 * (safeLinkUrl); and the photo route judges a file by its first bytes
 * (imageTypeOf), not by its Content-Type header.
 *
 * Pure: no database and no environment — callers pass the Blob token.
 */
import { answerKind } from "@/lib/fastfield";

/** Any Vercel Blob store's public host (used when our store isn't known). */
const BLOB_PUBLIC_HOST = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/;
/** Where the photo route stores FastField photos and signatures. */
const PHOTO_PATH = "/uploads/fastfield/";

/**
 * Our Blob store's public host, from its read-write token
 * ("vercel_blob_rw_<store id>_<secret>"), the way @vercel/blob builds its own
 * addresses. Null without a usable token: then any store's public host passes.
 */
export function blobStoreHost(token: string | null | undefined): string | null {
  const storeId = token?.split("_")[3];
  return storeId && /^[A-Za-z0-9]+$/.test(storeId)
    ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com`
    : null;
}

/**
 * Whether a photo or signature address is one the photo route hands out:
 * https, on our Blob store's public host (`host`; any store's when null),
 * under uploads/fastfield/.
 */
export function isOurPhotoUrl(url: unknown, host: string | null): url is string {
  if (typeof url !== "string" || url.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  if (host ? u.hostname !== host : !BLOB_PUBLIC_HOST.test(u.hostname)) return false;
  return u.pathname.startsWith(PHOTO_PATH);
}

const isBlank = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** A photo item's address: { url, comment? } as the robot sends it. */
const urlOf = (p: unknown) => (p && typeof p === "object" ? (p as { url?: unknown }).url : p);

/**
 * The report's photo and signature addresses with every one that isn't ours
 * left out — in photoUrls, signatureUrl and the photo and signature answers
 * (answerKind) — plus how many different addresses were dropped. Other
 * answers are untouched: the answers view shows them as text.
 */
export function keepOurMedia<A extends { type: string; value?: unknown }>(
  report: { answers: A[]; photoUrls?: unknown[] | null; signatureUrl?: unknown },
  host: string | null,
): { answers: A[]; photoUrls: string[]; signatureUrl: string | null; dropped: number } {
  const dropped = new Set<unknown>();
  const ours = (u: unknown): u is string => {
    if (isOurPhotoUrl(u, host)) return true;
    dropped.add(u);
    return false;
  };

  const photoUrls = (report.photoUrls ?? []).filter(ours);
  const sig = report.signatureUrl;
  const signatureUrl = isBlank(sig) ? null : ours(sig) ? sig : null;

  const answers = report.answers.map((a) => {
    const kind = answerKind(a.type);
    if ((kind !== "photo" && kind !== "signature") || isBlank(a.value)) return a;
    if (kind === "signature" || !Array.isArray(a.value)) {
      return ours(urlOf(a.value)) ? a : { ...a, value: null };
    }
    const kept = a.value.filter((p) => ours(urlOf(p)));
    if (kept.length === a.value.length) return a;
    return { ...a, value: kept.length ? kept : null };
  });

  return { answers, photoUrls, signatureUrl, dropped: dropped.size };
}

/**
 * An address that's safe in a link or an image: an absolute http(s) URL —
 * never javascript:, data:, a relative path or anything else. Null otherwise.
 */
export function safeLinkUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

const bytesAt = (b: Uint8Array, at: number, sig: number[]) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

/**
 * What an image file really is, from its first bytes: JPEG, PNG or WebP,
 * whatever its Content-Type header says. Null for anything else.
 */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  if (bytesAt(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF", four bytes of size, then "WEBP".
  if (bytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && bytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}

/**
 * An error's code (e.g. Prisma's "P2002") or else its name, for the logs and
 * an error response — never its message, which can quote a report's contents.
 */
export function errorCode(e: unknown): string {
  const o = (e ?? {}) as { code?: unknown; name?: unknown };
  for (const v of [o.code, o.name]) {
    const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
    if (/^[A-Za-z0-9_.:-]{1,60}$/.test(s)) return s;
  }
  return "error";
}
