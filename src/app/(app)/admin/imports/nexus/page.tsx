import Link from "next/link";
import {
  getResetCounts,
  resetSiteData,
  previewImport,
  commitImport,
} from "./_actions";
import { ResetPanel } from "./_components/ResetPanel";
import { ImportPanel } from "./_components/ImportPanel";

export const dynamic = "force-dynamic";

export default async function NexusImportPage() {
  const counts = await getResetCounts();

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
          Nexus CSV import
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Reset existing site data, then upload the latest Nexus export. Always
          safe to preview first — no DB writes happen until you click Import.
        </p>
      </div>

      <ResetPanel counts={counts} reset={resetSiteData} />
      <ImportPanel preview={previewImport} commit={commitImport} />
    </div>
  );
}
