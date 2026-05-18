import Link from "next/link";
import { previewSites, commitSites } from "./_actions";
import { SitesImportPanel } from "./_components/SitesImportPanel";

export const dynamic = "force-dynamic";

export default function SitesImportPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <Link
          href="/admin"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Sites CSV import
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl mt-1">
          Upload a list of sites (Shurgard, Aegis, Orbis, or any other CSV) and
          review what would happen before anything is written. Existing sites
          are matched by <span className="font-mono text-xs">code</span> when
          present, otherwise by name + postcode.
        </p>
      </div>

      <div className="card p-4 text-sm text-slate-700 space-y-2">
        <div className="font-medium text-brand-navy">CSV columns</div>
        <p>
          Required: <code className="text-xs bg-slate-100 px-1 rounded">name</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">postcode</code>.
        </p>
        <p>
          Optional:{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">code</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">addressLine</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">type</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">region</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">services</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">notes</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">customer</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">partner</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">lat</code>,{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">lng</code>.
        </p>
        <p className="text-xs text-slate-500">
          If <code className="text-xs bg-slate-100 px-1 rounded">customer</code>{" "}
          isn't given, sites whose name starts with{" "}
          <span className="font-medium">Shurgard</span>,{" "}
          <span className="font-medium">Aegis</span>, or{" "}
          <span className="font-medium">Orbis</span> are auto-linked. Sites with
          a code starting <span className="font-mono">NEX</span> are linked to
          Nexus Security. Unknown regions are created automatically.
        </p>
      </div>

      <SitesImportPanel preview={previewSites} commit={commitSites} />
    </div>
  );
}
