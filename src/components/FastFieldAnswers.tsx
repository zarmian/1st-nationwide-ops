import {
  answerCoords,
  answerKind,
  answerText,
  parseFastFieldTime,
  type FastFieldAnswer,
} from "@/lib/fastfield";
import { formatDateTime } from "@/lib/dates";
import { safeLinkUrl } from "@/lib/fastfieldIntake";

/**
 * A FastField report's answers in form order — photos, signature and GPS
 * shown as such. Used on the review page, /admin/fastfield/[id] and the
 * client portal's activity page. Only http(s) addresses go into a link or an
 * image (the import already keeps only our own storage's).
 */
export function FastFieldAnswers({
  answers,
  photoUrls,
  sentAt,
}: {
  answers: unknown;
  photoUrls: string[];
  /** When FastField received the report: settles a typed date that reads
   *  both ways ("11/02/2026"); without it such a date is shown as typed. */
  sentAt?: Date | null;
}) {
  const list = (Array.isArray(answers) ? answers : []) as FastFieldAnswer[];
  const shown = new Set<string>();
  for (const a of list) {
    for (const p of photosOf(a.value)) shown.add(p.url);
  }
  const extraPhotos = photoUrls
    .map(safeLinkUrl)
    .filter((u): u is string => u !== null && !shown.has(u));

  if (list.length === 0 && extraPhotos.length === 0) {
    return <p className="text-sm text-slate-500">No answers in this report.</p>;
  }

  return (
    <dl className="grid sm:grid-cols-[220px_1fr] gap-y-2 gap-x-4 text-sm">
      {list.map((a, i) => (
        <Answer key={`${a.key}-${i}`} answer={a} sentAt={sentAt ?? null} />
      ))}
      {extraPhotos.length > 0 && (
        <>
          <dt className="text-slate-500">Other photos</dt>
          <dd>
            <PhotoGrid photos={extraPhotos.map((url) => ({ url }))} />
          </dd>
        </>
      )}
    </dl>
  );
}

type Photo = { url: string; comment?: string | null };

/** The photos in an answer, each with a safe (http/https) address. */
function photosOf(value: unknown): Photo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const url = safeLinkUrl((p as Photo).url);
    return url ? [{ ...(p as Photo), url }] : [];
  });
}

const TRI: Record<number, string> = { 0: "No", 1: "Yes", 2: "N/A" };

function Answer({ answer: a, sentAt }: { answer: FastFieldAnswer; sentAt: Date | null }) {
  const label = <dt className="text-slate-500 break-words">{a.label}</dt>;
  const kind = answerKind(a.type);
  const empty = (
    <>
      {label}
      <dd className="text-slate-400">—</dd>
    </>
  );

  if (kind === "photo") {
    const photos = photosOf(a.value);
    if (!photos.length) {
      return (
        <>
          {label}
          <dd className="text-slate-400">Photos not copied</dd>
        </>
      );
    }
    return (
      <>
        {label}
        <dd>
          <PhotoGrid photos={photos} />
        </dd>
      </>
    );
  }

  if (kind === "signature") {
    const signature = safeLinkUrl(a.value);
    if (!signature?.startsWith("https://")) return empty;
    return (
      <>
        {label}
        <dd>
          <img
            src={signature}
            alt="Signature"
            width={240}
            height={96}
            className="max-h-24 w-auto border border-slate-200 rounded bg-white p-1"
          />
        </dd>
      </>
    );
  }

  if (kind === "location") {
    const c = answerCoords(a);
    if (!c) return empty;
    const address =
      a.value && typeof a.value === "object"
        ? answerText((a.value as Record<string, unknown>).formatted_address)
        : null;
    return (
      <>
        {label}
        <dd className="text-slate-800">
          <a
            href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
            target="_blank"
            rel="noreferrer"
            className="text-brand-blue-dark hover:underline font-mono text-xs"
          >
            {c.lat.toFixed(6)}, {c.lng.toFixed(6)}
          </a>
          {address && address !== "N/A" && (
            <span className="block text-xs text-slate-500">{address}</span>
          )}
        </dd>
      </>
    );
  }

  if (kind === "date") {
    const t = parseFastFieldTime(a.value, sentAt);
    const text = t ? formatDateTime(t) : answerText(a.value);
    if (!text) return empty;
    return (
      <>
        {label}
        <dd className="text-slate-800">{text}</dd>
      </>
    );
  }

  if (kind === "tri") {
    const n = typeof a.value === "string" ? Number(a.value) : a.value;
    if (typeof n === "number" && n in TRI) {
      return (
        <>
          {label}
          <dd className="text-slate-800">{TRI[n]}</dd>
        </>
      );
    }
  }

  const text =
    answerText(a.value) ??
    (a.value && typeof a.value === "object" ? JSON.stringify(a.value).slice(0, 2000) : null);
  if (!text) return empty;
  return (
    <>
      {label}
      <dd className="text-slate-800 whitespace-pre-line break-words">{text}</dd>
    </>
  );
}

function PhotoGrid({ photos }: { photos: Photo[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-w-lg">
      {photos.map((p, i) => (
        <a
          key={`${p.url}-${i}`}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="block"
          title={p.comment || undefined}
        >
          <img
            src={p.url}
            alt={p.comment || `Photo ${i + 1}`}
            width={160}
            height={160}
            loading="lazy"
            className="aspect-square w-full object-cover rounded border border-slate-200"
          />
        </a>
      ))}
    </div>
  );
}
