"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PreviewResult, CommitResult } from "../_actions";

export function ImportPanel({
  preview,
  commit,
}: {
  preview: (formData: FormData) => Promise<PreviewResult>;
  commit: (formData: FormData) => Promise<CommitResult>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(
    null,
  );
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  function getFile(): File | null {
    return fileRef.current?.files?.[0] ?? null;
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFileName(f?.name ?? null);
    setPreviewResult(null);
    setCommitResult(null);
  }

  function onPreview() {
    const f = getFile();
    if (!f) return;
    const fd = new FormData();
    fd.append("csv", f);
    startTransition(async () => {
      const r = await preview(fd);
      setPreviewResult(r);
      setCommitResult(null);
    });
  }

  function onCommit() {
    const f = getFile();
    if (!f) return;
    const proceed = window.confirm(
      "Import this CSV into the live database? Existing matched sites will be updated and their rates replaced.",
    );
    if (!proceed) return;
    const fd = new FormData();
    fd.append("csv", f);
    startTransition(async () => {
      const r = await commit(fd);
      setCommitResult(r);
      if (r.ok) router.refresh();
    });
  }

  const previewOk = previewResult?.ok === true;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Import Nexus CSV</h2>
        <p className="text-sm text-slate-500">
          Upload the latest export from Nexus. Preview shows what would happen;
          import commits it. Re-runs are safe — sites match by{" "}
          <span className="font-mono text-xs">Reference</span> and rates are
          refreshed each time.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="csv">
          CSV file
        </label>
        <input
          id="csv"
          name="csv"
          type="file"
          accept=".csv,text/csv"
          ref={fileRef}
          onChange={onFile}
          disabled={pending}
          className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:text-sm file:font-medium hover:file:bg-slate-50"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPreview}
          disabled={!fileName || pending}
          className="btn-secondary text-sm"
        >
          {pending && !commitResult ? "Previewing…" : "Preview"}
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={!fileName || !previewOk || pending}
          className={
            previewOk
              ? "btn-primary text-sm"
              : "btn-primary text-sm opacity-50 cursor-not-allowed"
          }
        >
          {pending && commitResult === null && previewOk
            ? "Importing…"
            : "Import"}
        </button>
      </div>

      {previewResult && !previewResult.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {previewResult.error}
        </div>
      )}

      {previewResult?.ok && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Preview — what would happen
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <Stat label="Rows read" value={previewResult.read} />
            <Stat label="Sites to create" value={previewResult.toCreate} />
            <Stat label="Sites to update" value={previewResult.toUpdate} />
            <Stat label="Rate rows" value={previewResult.ratesToWrite} />
          </div>
          {previewResult.skipped.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-700">
                {previewResult.skipped.length} row
                {previewResult.skipped.length === 1 ? "" : "s"} would be
                skipped
              </summary>
              <ul className="mt-2 ml-4 list-disc text-slate-500 space-y-0.5">
                {previewResult.skipped.slice(0, 20).map((s, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">
                      {s.reference ?? "(no reference)"}
                    </span>
                    {" — "}
                    {s.reason}
                  </li>
                ))}
                {previewResult.skipped.length > 20 && (
                  <li>… and {previewResult.skipped.length - 20} more</li>
                )}
              </ul>
            </details>
          )}
          <p className="text-xs text-slate-500">
            Click <span className="font-medium">Import</span> to commit.
          </p>
        </div>
      )}

      {commitResult && !commitResult.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {commitResult.error}
        </div>
      )}

      {commitResult?.ok && (
        <div className="rounded-xl border border-brand-blue/40 bg-brand-blue-light p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-brand-blue-dark">
            Import complete
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Stat label="Created" value={commitResult.created} tone="mint" />
            <Stat label="Updated" value={commitResult.updated} tone="mint" />
            <Stat
              label="Rates written"
              value={commitResult.ratesWritten}
              tone="mint"
            />
          </div>
          {commitResult.skipped.length > 0 && (
            <p className="text-xs text-slate-700">
              {commitResult.skipped.length} row
              {commitResult.skipped.length === 1 ? "" : "s"} were skipped — see
              preview above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "mint";
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={
          tone === "mint"
            ? "text-2xl font-semibold text-brand-blue-dark tabular-nums"
            : "text-2xl font-semibold text-brand-navy tabular-nums"
        }
      >
        {value.toLocaleString("en-GB")}
      </div>
    </div>
  );
}
