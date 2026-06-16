import {
  getResetCounts,
  resetData,
  previewImport,
  commitImport,
} from "./_actions";
import { ResetPanel } from "./_components/ResetPanel";
import { ImportPanel } from "./_components/ImportPanel";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NexusImportPage() {
  const counts = await getResetCounts();

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="Nexus CSV import"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Reset existing data, then upload the latest Nexus export. Always safe to preview first — no DB writes happen until you click Import."
      />

      <ResetPanel counts={counts} reset={resetData} />
      <ImportPanel preview={previewImport} commit={commitImport} />
    </div>
  );
}
