import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { requireStaff } from "@/lib/authz";
import { listJobSourceOptions, listJobTypeOptions } from "@/lib/labels";
import { updateJob } from "../../_actions";
import { EditJobForm } from "../../_components/EditJobForm";

export const dynamic = "force-dynamic";

const SHIFT_TYPE_CODES = new Set(["STATIC_GUARDING_SHIFT", "DOG_HANDLER_SHIFT"]);

export default async function EditJobPage({
  params,
}: {
  params: { id: string };
}) {
  await requireStaff();

  const [job, allJobTypes, allJobSources, officers, partners] =
    await Promise.all([
      prisma.job.findUnique({
        where: { id: params.id },
        include: {
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              postcodeFormatted: true,
            },
          },
        },
      }),
      listJobTypeOptions(),
      listJobSourceOptions(),
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
    ]);

  if (!job) notFound();

  // A job can arrive without a site we know (a Keyholding job for a property
  // that isn't in the system yet). It's still editable, and the form offers
  // the site list so it can be attached once the site has been added.
  const sites = job.site
    ? []
    : await prisma.site.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true, postcodeFormatted: true },
      });

  // Shift-type jobs have their own flow — don't expose them in the picker
  // here.
  const jobTypes = allJobTypes.filter((o) => !SHIFT_TYPE_CODES.has(o.code));

  const editableJob = {
    id: job.id,
    type: job.type,
    typeLabel: job.typeLabel,
    source: job.source,
    priority: job.priority,
    status: job.status,
    scheduledFor: job.scheduledFor?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    handedOffAt: job.handedOffAt?.toISOString() ?? null,
    assignedToUserId: job.assignedToUserId,
    handledByPartnerId: job.handledByPartnerId,
    externalResponder: job.externalResponder,
    notes: job.notes,
    partnerReportRef: job.partnerReportRef,
    excludeFromClientReport: job.excludeFromClientReport,
    site: job.site
      ? { name: job.site.name, code: job.site.code, postcode: job.site.postcodeFormatted }
      : null,
  };

  const boundAction = updateJob.bind(null, job.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit job"
        backHref={`/dispatch/${job.id}`}
        backLabel="Back to job"
        subtitle="Admin override for any Job's content. Status / cancellation flow through their own buttons elsewhere — they're not free-text editable here. Saved changes appear immediately in dispatch and the activities log."
      />

      <EditJobForm
        job={editableJob}
        jobTypes={jobTypes}
        jobSources={allJobSources}
        officers={officers}
        partners={partners}
        sites={sites.map((s) => ({
          id: s.id,
          label: `${s.code ? `${s.code} — ` : ""}${s.name}${s.postcodeFormatted ? ` (${s.postcodeFormatted})` : ""}`,
        }))}
        action={boundAction}
      />
    </div>
  );
}
