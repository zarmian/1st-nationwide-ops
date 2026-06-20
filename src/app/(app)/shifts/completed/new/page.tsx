import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { CompletedShiftForm } from "../../_components/CompletedShiftForm";
import { recordCompletedShift } from "../../_actions";

export const dynamic = "force-dynamic";

/**
 * Staff-side "Record completed shift" — analogous to
 * /dispatch/callouts/new for jobs. Lands a Shift row at status
 * COMPLETED with actualStartedAt / EndedAt filled in. Either our
 * officer or a partner can be the handler.
 */
export default async function RecordCompletedShiftPage() {
  await requireStaff();

  const [sites, officers, partners] = await Promise.all([
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
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true, role: { in: ["SUBCONTRACTOR", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Record completed shift"
        backHref="/shifts"
        backLabel="Shifts"
        subtitle="Log a shift that's already been done — for record keeping and officer pay. Skips the check-in / clock-in flow. Pick our officer or a subcontracting partner as the handler."
      />
      <CompletedShiftForm
        action={recordCompletedShift}
        sites={sites}
        officers={officers}
        partners={partners}
      />
    </div>
  );
}
