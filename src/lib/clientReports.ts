/**
 * What a client may see of an officer's report — pure, so it's unit-tested.
 *
 * A report's payload is whatever its form captured: the officer's answers,
 * plus things only we use (GPS fixes, geofence distances, check-in slot
 * numbers, import bookkeeping). This keeps the answers, photos and signature
 * and drops the rest. Anything it doesn't recognise as a plain answer is
 * left out rather than shown raw.
 */
import type { FieldDef } from "@/lib/formTemplates";

export type ClientReportField = { label: string; value: string };
export type ClientReportPhoto = { url: string; caption: string | null };
export type ClientReportBody = {
  fields: ClientReportField[];
  photos: ClientReportPhoto[];
  signatureUrl: string | null;
};

/** Payload keys that are ours, not the officer's answers. */
const HIDDEN_KEYS = new Set([
  "source",
  "fastfield",
  "kind",
  "slotIndex",
  "dueAt",
  "withinGeofence",
  "distanceM",
  "distance",
  "accuracy",
  "gps",
  "location",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "capturedAt",
  "token",
  "officerId",
  "userId",
  "siteId",
  "jobId",
  "shiftId",
  "visitId",
  "patrolVisitId",
  "deviceId",
  "legs",
  "ip",
  "userAgent",
]);

const IMAGE_URL = /^https:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:[?#]\S*)?$/i;
const TRI: Record<number, string> = { 0: "No", 1: "Yes", 2: "N/A" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "arrived_at" / "arrivedAt" → "Arrived at". */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** A form's own date/time text ("2026-10-20T21:15", UK wall clock) as
 *  "20 Oct 2026, 21:15" — without moving it through a time zone. */
export function formatFormDateTime(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return s;
  const date = `${Number(m[3])} ${month} ${m[1]}`;
  return m[4] ? `${date}, ${m[4]}:${m[5]}` : date;
}

function isLocation(v: unknown): boolean {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as { lat?: unknown }).lat === "number" &&
    typeof (v as { lng?: unknown }).lng === "number"
  );
}

/** A list of photos (URLs or {url, name/comment}), or null when it isn't
 *  one — e.g. a multi-choice answer. */
function photoList(v: unknown): ClientReportPhoto[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: ClientReportPhoto[] = [];
  for (const p of v) {
    if (typeof p === "string" && IMAGE_URL.test(p)) out.push({ url: p, caption: null });
    else if (p && typeof p === "object" && typeof (p as { url?: unknown }).url === "string") {
      const o = p as { url: string; name?: unknown; comment?: unknown };
      const caption =
        typeof o.comment === "string" && o.comment.trim()
          ? o.comment.trim()
          : typeof o.name === "string" && o.name.trim()
            ? o.name.trim()
            : null;
      out.push({ url: o.url, caption });
    } else return null; // not a photo list
  }
  return out;
}

/** The client-safe content of one report payload. `fields` are the form
 *  template's field definitions, when the report came from one. */
export function clientReportBody(payload: unknown, fields: FieldDef[] = []): ClientReportBody {
  const body: ClientReportBody = { fields: [], photos: [], signatureUrl: null };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return body;
  const record = payload as Record<string, unknown>;
  const defs = new Map(fields.map((f) => [f.key, f]));
  // The template's order first, then anything else the payload holds.
  const keys = [
    ...fields.map((f) => f.key).filter((k) => k in record),
    ...Object.keys(record).filter((k) => !defs.has(k)),
  ];
  const seenPhotos = new Set<string>();
  const addPhoto = (p: ClientReportPhoto) => {
    if (seenPhotos.has(p.url) || p.url === body.signatureUrl) return;
    seenPhotos.add(p.url);
    body.photos.push(p);
  };

  for (const key of keys) {
    if (HIDDEN_KEYS.has(key) || key.startsWith("_")) continue;
    const value = record[key];
    const def = defs.get(key);
    const type = def?.type;
    if (type === "section" || type === "location" || isLocation(value)) continue;
    if (value === null || value === undefined || value === "") continue;

    if (type === "signature" || (/signature/i.test(key) && typeof value === "string")) {
      if (typeof value === "string" && IMAGE_URL.test(value) && !body.signatureUrl) {
        body.signatureUrl = value;
      }
      continue;
    }
    const photos = photoList(value);
    if (photos) {
      photos.forEach(addPhoto);
      continue;
    }
    if (typeof value === "string" && IMAGE_URL.test(value)) {
      addPhoto({ url: value, caption: null });
      continue;
    }

    const label = def?.label ?? humaniseKey(key);
    let text: string | null = null;
    if (type === "tri" && typeof value === "number" && value in TRI) text = TRI[value];
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      text = (value as string[]).map((v) => v.trim()).filter(Boolean).join(", ") || null;
    } else if (typeof value === "boolean") text = value ? "Yes" : "No";
    else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
    else if (typeof value === "string") {
      const t = value.trim();
      text = t ? (type === "date" || type === "datetime" ? formatFormDateTime(t) : t) : null;
    }
    if (text) body.fields.push({ label, value: text });
  }
  return body;
}
