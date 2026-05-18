"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  SitesPreviewActionResult,
  SitesCommitActionResult,
} from "../_actions";

export function SitesImportPanel({
  preview,
  commit,
}: {
  preview: (formData: FormData) => Promise<SitesPreviewActionResult>;
  commit: (formData: FormData) => Promise<SitesCommitActionResult>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewResult, setPreviewResult] =
    useState<SitesPreviewActionResult | null>(null);
  const [commitResult, setCommitResult] =
    useState<SitesCommitActionResult | null>(null);

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
    if (!f || !previewResult?.ok) return;
    const total = previewResult.toCreate + previewResult.toUpdate;
    const proceed = window.confirm(
      `Import ${total} site${total === 1 ? "" : "s"} into the live database?` +
        ` This will create ${previewResult.toCreate} and update ${previewResult.toUpdate}.`,
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
  const previewing = pending && commitResult === null && !previewOk;
  const committing = pending && previewOk && commitResult === null;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Upload &amp; preview</h2>
        <p className="text-sm text-slate-500">
          Nothing is written until you click <span className="font-medium">Import</span> on the preview.
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
          {previewing ? "Previewing…" : "Preview"}
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
          {committing ? "Importing…" : "Import"}
        </button>
      </div>

      {previewResult && !previewResult.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {previewResult.error}
        </div>
      )}

      {previewResult?.ok && (
        <PreviewBlock result={previewResult} />
      )}

      {commitResult && !commitResult.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {commitResult.error}
        </div>
      )}

      {commitResult?.ok && <CommitBlock result={commitResult} />}
    </div>
  );
}

function PreviewBlock({
  result,
}: {
  result: Extract<SitesPreviewActionResult, { ok: true }>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        Preview — what would happen
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Rows read" value={result.read} />
        <Stat label="To create" value={result.toCreate} />
        <Stat label="To update" value={result.toUpdate} />
        <Stat label="Skipped" value={result.skipped.length} />
      </div>

      <TagBreakdown
        byCustomer={result.byCustomer}
        byPartner={result.byPartner}
        untagged={result.untagged}
      />

      <SampleTable rows={result.sample} />

      {result.skipped.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-700">
            {result.skipped.length} row
            {result.skipped.length === 1 ? "" : "s"} skipped
          </summary>
          <ul className="mt-2 ml-4 list-disc text-slate-500 space-y-0.5">
            {result.skipped.slice(0, 50).map((s) => (
              <li key={s.rowIndex}>
                Row {s.rowIndex}
                {s.name ? ` — ${s.name}` : ""}: {s.reason}
              </li>
            ))}
            {result.skipped.length > 50 && (
              <li>… and {result.skipped.length - 50} more</li>
            )}
          </ul>
        </details>
      )}

      <p className="text-xs text-slate-500">
        Happy with it? Click <span className="font-medium">Import</span> above.
      </p>
    </div>
  );
}

function TagBreakdown({
  byCustomer,
  byPartner,
  untagged,
}: {
  byCustomer: Record<string, number>;
  byPartner: Record<string, number>;
  untagged: number;
}) {
  const customers = Object.entries(byCustomer).sort((a, b) => b[1] - a[1]);
  const partners = Object.entries(byPartner).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        Auto-tagging
      </div>
      <div className="flex flex-wrap gap-2">
        {customers.map(([name, n]) => (
          <span key={`c-${name}`} className="chip-mint">
            {name}: {n}
          </span>
        ))}
        {partners.map(([name, n]) => (
          <span key={`p-${name}`} className="chip-amber">
            {name} (partner): {n}
          </span>
        ))}
        {untagged > 0 && (
          <span className="chip-slate">No tag: {untagged}</span>
        )}
        {customers.length === 0 && partners.length === 0 && untagged === 0 && (
          <span className="text-xs text-slate-500 italic">—</span>
        )}
      </div>
    </div>
  );
}

function SampleTable({
  rows,
}: {
  rows: Extract<SitesPreviewActionResult, { ok: true }>["sample"];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No rows to preview.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        First {rows.length} row{rows.length === 1 ? "" : "s"}
      </div>
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 px-2">#</th>
              <th className="py-1.5 px-2">Action</th>
              <th className="py-1.5 px-2">Code</th>
              <th className="py-1.5 px-2">Name</th>
              <th className="py-1.5 px-2">Postcode</th>
              <th className="py-1.5 px-2">Region</th>
              <th className="py-1.5 px-2">Tag</th>
              <th className="py-1.5 px-2">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowIndex} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 px-2 text-slate-400 tabular-nums">{r.rowIndex}</td>
                <td className="py-1.5 px-2">
                  <span
                    className={
                      r.action === "CREATE" ? "chip-mint" : "chip-slate"
                    }
                  >
                    {r.action}
                  </span>
                </td>
                <td className="py-1.5 px-2 font-mono">{r.code ?? "—"}</td>
                <td className="py-1.5 px-2 font-medium text-brand-navy">{r.name}</td>
                <td className="py-1.5 px-2">{r.postcodeFormatted}</td>
                <td className="py-1.5 px-2 text-slate-600">{r.region ?? "—"}</td>
                <td className="py-1.5 px-2 text-slate-600">
                  {r.customer ?? (r.partner ? `${r.partner} (P)` : "—")}
                </td>
                <td className="py-1.5 px-2 text-amber-700">
                  {r.warnings.length === 0 ? "" : r.warnings.join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommitBlock({
  result,
}: {
  result: Extract<SitesCommitActionResult, { ok: true }>;
}) {
  return (
    <div className="rounded-xl border border-brand-mint/40 bg-brand-mint-light p-4 space-y-2">
      <div className="text-xs uppercase tracking-wider text-brand-mint-dark">
        Import complete
      </div>
      <div className="grid sm:grid-cols-5 gap-3">
        <Stat label="Created" value={result.created} tone="mint" />
        <Stat label="Updated" value={result.updated} tone="mint" />
        <Stat label="Customers linked" value={result.customersLinked} tone="mint" />
        <Stat label="Partners linked" value={result.partnersLinked} tone="mint" />
        <Stat label="Regions added" value={result.regionsCreated} tone="mint" />
      </div>
      {result.skipped.length > 0 && (
        <p className="text-xs text-slate-700">
          {result.skipped.length} row
          {result.skipped.length === 1 ? "" : "s"} were skipped — see the preview above.
        </p>
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
            ? "text-2xl font-semibold text-brand-mint-dark tabular-nums"
            : "text-2xl font-semibold text-brand-navy tabular-nums"
        }
      >
        {value.toLocaleString("en-GB")}
      </div>
    </div>
  );
}
