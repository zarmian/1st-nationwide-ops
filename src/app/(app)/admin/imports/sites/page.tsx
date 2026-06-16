import {
  previewSites,
  commitSites,
  geocodeMissingSites,
  regeocodeAllSites,
  countSitesMissingCoords,
  countSitesWithPostcode,
} from "./_actions";
import { SitesImportPanel } from "./_components/SitesImportPanel";
import { GeocodePanel } from "./_components/GeocodePanel";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SitesImportPage() {
  const [missingCoords, totalWithPostcode] = await Promise.all([
    countSitesMissingCoords(),
    countSitesWithPostcode(),
  ]);
  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="Sites CSV import"
        backHref="/admin"
        backLabel="Admin"
        subtitle={
          <>
            Upload a list of sites (Shurgard, Aegis, Orbis, or any other
            CSV) and review what would happen before anything is written.
            Existing sites are matched by{" "}
            <span className="font-mono text-xs">code</span> when present,
            otherwise by name + postcode.
          </>
        }
      />

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

      <GeocodePanel
        missing={missingCoords}
        total={totalWithPostcode}
        geocode={geocodeMissingSites}
        regeocodeAll={regeocodeAllSites}
      />
    </div>
  );
}
