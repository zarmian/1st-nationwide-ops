import { prisma } from "@/lib/db";
import { createJob } from "../_actions";
import { PageHeader } from "@/components/PageHeader";
import { NewJobForm } from "../_components/NewJobForm";
import { listJobSourceOptions, listJobTypeOptions } from "@/lib/labels";

export const dynamic = "force-dynamic";

// NewJobForm covers one-off jobs only. Shift types are created via the
// shift flow; we filter them out here so they don't appear in the picker.
const NEW_JOB_TYPE_EXCLUDED = new Set([
  "STATIC_GUARDING_SHIFT",
  "DOG_HANDLER_SHIFT",
]);

// The manual add-job flow only offers the sources an office user picks by
// hand. Alarm activations arrive by ingestion/webhook and ad-hoc work is
// logged via the callout flow, so both are dropped from this dropdown.
const NEW_JOB_SOURCE_EXCLUDED = new Set(["ALARM", "AD_HOC"]);

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: { siteId?: string };
}) {
  const [sites, officers, partners, allJobTypes, allJobSources] = await Promise.all([
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        postcodeFormatted: true,
      },
    }),
    prisma.user.findMany({
      // Officers only — jobs are never assigned to dispatchers.
      where: { active: true, role: "OFFICER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true, role: { in: ["SUBCONTRACTOR", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listJobTypeOptions(),
    listJobSourceOptions(),
  ]);

  // Dedupe by label so a duplicate option row never shows the same type twice.
  const seenTypeLabel = new Set<string>();
  const jobTypes = allJobTypes
    .filter((o) => !NEW_JOB_TYPE_EXCLUDED.has(o.code))
    .filter((o) => {
      const key = o.label.trim().toLowerCase();
      if (seenTypeLabel.has(key)) return false;
      seenTypeLabel.add(key);
      return true;
    });
  const jobSources = allJobSources
    .filter((o) => !NEW_JOB_SOURCE_EXCLUDED.has(o.code))
    // Show the partner-request source as "Nexus" — our standing partner.
    .map((o) => (o.code === "PARTNER_REQUEST" ? { ...o, label: "Nexus" } : o));

  return (
    <div className="space-y-4">
      <PageHeader
        title="New job"
        backHref="/dispatch"
        backLabel="Dispatch"
        subtitle="Create a one-off job — alarm response, ad-hoc, lock/unlock, key movement, VPI, or one-off patrol. Static guarding / dog handler shifts use a different flow (coming soon)."
      />

      <NewJobForm
        action={createJob}
        sites={sites}
        officers={officers}
        partners={partners}
        jobTypes={jobTypes}
        jobSources={jobSources}
        defaultSiteId={searchParams.siteId}
      />
    </div>
  );
}
