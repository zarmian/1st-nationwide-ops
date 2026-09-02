import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { requireStaff } from "@/lib/authz";
import { updatePatrolVisit } from "../../../_actions";
import { EditVisitForm } from "../../../_components/EditVisitForm";

export const dynamic = "force-dynamic";

export default async function EditVisitPage({
  params,
}: {
  params: { id: string };
}) {
  await requireStaff();

  const [visit, officers, partners] = await Promise.all([
    prisma.patrolVisit.findUnique({
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
        patrolSchedule: { select: { kind: true } },
      },
    }),
    prisma.user.findMany({
      // Officers only — visits are never assigned to dispatchers.
      where: { active: true, role: "OFFICER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!visit || !visit.site) notFound();

  const editableVisit = {
    id: visit.id,
    scheduledAt: visit.scheduledAt.toISOString(),
    arrivedAt: visit.arrivedAt?.toISOString() ?? null,
    departedAt: visit.departedAt?.toISOString() ?? null,
    status: visit.status,
    officerId: visit.officerId,
    handledByPartnerId: visit.handledByPartnerId,
    reportedViaPartnerApp: visit.reportedViaPartnerApp,
    notes: visit.notes,
    siteName: visit.site.name,
    siteCode: visit.site.code,
    sitePostcode: visit.site.postcodeFormatted,
    kindLabel: visit.patrolSchedule?.kind === "VPI" ? "VPI visit" : "Patrol visit",
  };

  const boundAction = updatePatrolVisit.bind(null, visit.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit visit"
        backHref={`/patrols/visits/${visit.id}`}
        backLabel="Back to visit"
        subtitle="Admin override for any PatrolVisit. Same shape as the job editor — same activity to you, same tool."
      />

      <EditVisitForm
        visit={editableVisit}
        officers={officers}
        partners={partners}
        action={boundAction}
      />
    </div>
  );
}
