import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { updatePatrolVisit } from "../../../_actions";
import { EditVisitForm } from "../../../_components/EditVisitForm";

export const dynamic = "force-dynamic";

export default async function EditVisitPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();

  const [visit, officers] = await Promise.all([
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
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
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
    notes: visit.notes,
    siteName: visit.site.name,
    siteCode: visit.site.code,
    sitePostcode: visit.site.postcodeFormatted,
    kindLabel: visit.patrolSchedule?.kind === "VPI" ? "VPI visit" : "Patrol visit",
  };

  const boundAction = updatePatrolVisit.bind(null, visit.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/patrols/visits/${visit.id}`}
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Back to visit
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Edit visit
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Admin override for any PatrolVisit. Same shape as the job
          editor — same activity to you, same tool.
        </p>
      </div>

      <EditVisitForm
        visit={editableVisit}
        officers={officers}
        action={boundAction}
      />
    </div>
  );
}
