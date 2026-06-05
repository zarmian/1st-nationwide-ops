"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useState } from "react";
import { upload } from "@vercel/blob/client";
import type { KeySetUpdateState } from "../../../keys/_actions";

export function KeySetForm({
  action,
  initial,
  siteId,
}: {
  action: (
    state: KeySetUpdateState,
    fd: FormData,
  ) => Promise<KeySetUpdateState>;
  initial: {
    label: string;
    internalNo: string | null;
    notes: string | null;
    photoUrl: string | null;
  };
  siteId: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial.photoUrl);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await upload(`uploads/key-sets/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload-token",
        clientPayload: JSON.stringify({ siteId }),
      });
      setPhotoUrl(result.url);
    } catch (err: any) {
      setUploadError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={formAction} className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Set details</h2>
        <p className="text-sm text-slate-500">
          Edit the set's label, code, and reference photo.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="label">Label</label>
          <input
            id="label"
            name="label"
            defaultValue={initial.label}
            required
            maxLength={120}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="internalNo">Internal no.</label>
          <input
            id="internalNo"
            name="internalNo"
            defaultValue={initial.internalNo ?? ""}
            maxLength={60}
            className="input"
            placeholder="e.g. SET-0042"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial.notes ?? ""}
          maxLength={2000}
          rows={3}
          className="input"
        />
      </div>

      <div>
        <label className="label">Reference photo</label>
        <p className="text-xs text-slate-500 mb-2">
          One photo of the physical bunch — helps officers recognise the set
          on arrival.
        </p>
        <input type="hidden" name="photoUrl" value={photoUrl ?? ""} />
        {photoUrl ? (
          <div className="space-y-2">
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Key set"
                className="rounded-xl border border-slate-200 max-w-full max-h-64"
              />
              <button
                type="button"
                onClick={() => setPhotoUrl(null)}
                className="absolute top-1 right-1 bg-white/95 rounded-full w-7 h-7 grid place-items-center text-red-600 shadow"
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
            <label className="btn-secondary text-xs cursor-pointer inline-block">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onFile}
                className="hidden"
              />
              {uploading ? "Uploading…" : "Replace photo"}
            </label>
          </div>
        ) : (
          <label className="btn-secondary text-sm cursor-pointer inline-block">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              className="hidden"
            />
            {uploading ? "Uploading…" : "Upload photo"}
          </label>
        )}
        {uploadError && (
          <p className="text-xs text-red-600 mt-1">{uploadError}</p>
        )}
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm text-brand-blue-dark">Saved.</p>
      )}

      <div className="flex items-center gap-2 justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary text-sm">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
