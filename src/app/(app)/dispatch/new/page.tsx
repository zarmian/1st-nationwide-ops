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

  const jobTypes = allJobTypes.filter(
    (o) => !NEW_JOB_TYPE_EXCLUDED.has(o.code),
  );

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
        jobSources={allJobSources}
        defaultSiteId={searchParams.siteId}
      />
    </div>
  );
}
