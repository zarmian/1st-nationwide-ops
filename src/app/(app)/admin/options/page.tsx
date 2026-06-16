import { requireAdmin } from "@/lib/authz";
import {
  JOB_SOURCE_CODES,
  JOB_TYPE_CODES,
  ensureOptionsSeeded,
  listJobSourceOptions,
  listJobTypeOptions,
} from "@/lib/labels";
import { OptionsManager } from "./_components/OptionsManager";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function OptionsAdminPage() {
  await requireAdmin();
  // Seed the lookup tables on first visit so a fresh DB doesn't show an
  // empty admin page. ensureOptionsSeeded is idempotent — no-ops once the
  // defaults are in place. Existing custom labels / sort orders are
  // preserved.
  await ensureOptionsSeeded();

  const [jobTypes, jobSources] = await Promise.all([
    listJobTypeOptions({ includeInactive: true }),
    listJobSourceOptions({ includeInactive: true }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Picker options"
        backHref="/admin"
        backLabel="Admin"
        subtitle={
          <>
            The labels and order that appear in dropdowns when recording a
            callout or creating a new job. You can rename labels, hide
            options you don't use, and add alias labels that map to an
            existing category (e.g. add "Spot check" under Mobile patrol).
            The underlying category list is fixed in the schema — to add a
            brand-new category, ask a developer.
          </>
        }
      />

      <OptionsManager
        jobTypes={jobTypes}
        jobSources={jobSources}
        jobTypeCodes={JOB_TYPE_CODES as unknown as string[]}
        jobSourceCodes={JOB_SOURCE_CODES as unknown as string[]}
      />
    </div>
  );
}
