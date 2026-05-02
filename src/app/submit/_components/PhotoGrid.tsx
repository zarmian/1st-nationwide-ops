"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

export type Photo = { url: string; name: string | null };

export function PhotoGrid({
  value,
  onChange,
  siteId,
  maxCount,
}: {
  value: Photo[];
  onChange: (photos: Photo[]) => void;
  siteId: string;
  maxCount: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    const remaining = maxCount - value.length;
    if (remaining <= 0) {
      setError(`You can attach at most ${maxCount} photo${maxCount === 1 ? "" : "s"}.`);
      return;
    }
    const toUpload = files.slice(0, remaining);
    const skipped = files.length - toUpload.length;

    setBusy(true);
    setError(skipped > 0 ? `Only ${remaining} more photo${remaining === 1 ? "" : "s"} allowed — skipped ${skipped}.` : null);
    setProgress({ done: 0, total: toUpload.length });

    const next: Photo[] = [...value];
    for (const file of toUpload) {
      try {
        const result = await upload(`uploads/photos/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload-token",
          clientPayload: JSON.stringify({ siteId }),
        });
        next.push({ url: result.url, name: file.name });
        onChange([...next]);
      } catch (err: any) {
        setError(err?.message ?? `Could not upload ${file.name}`);
        break;
      }
      setProgress((p) => (p ? { done: p.done + 1, total: p.total } : null));
    }
    setBusy(false);
    setProgress(null);
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((p, i) => (
            <div key={p.url} className="relative aspect-square">
              <img
                src={p.url}
                alt={p.name ?? `Photo ${i + 1}`}
                className="w-full h-full object-cover rounded-lg border border-slate-200"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-1 right-1 bg-white/90 rounded-full w-6 h-6 grid place-items-center text-red-600 text-xs shadow"
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {value.length < maxCount && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={onPick}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn-secondary text-sm w-full"
            disabled={busy}
          >
            {busy
              ? progress
                ? `Uploading ${progress.done + 1} / ${progress.total}…`
                : "Uploading…"
              : value.length === 0
                ? `Add photos (up to ${maxCount})`
                : `Add another (${value.length} / ${maxCount})`}
          </button>
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
