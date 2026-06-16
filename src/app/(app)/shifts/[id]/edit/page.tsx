import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { updateShift } from "../../_actions";
import { NewShiftForm } from "../../_components/NewShiftForm";

export const dynamic = "force-dynamic";

function toLocalInput(d: Date): string {
  // datetime-local wants "yyyy-MM-ddTHH:mm" in the user's local time. We
  // render in Europe/London since that's where everyone is.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function EditShiftPage({
  params,
}: {
  params: { id: string };
}) {
  const [shift, sites, officers] = await Promise.all([
    prisma.shift.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        siteId: true,
        officerId: true,
        type: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        checkIntervalMin: true,
        graceMinutes: true,
        notes: true,
      },
    }),
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, postcodeFormatted: true },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!shift) notFound();

  const action = updateShift.bind(null, shift.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit shift"
        backHref={`/shifts/${shift.id}`}
        backLabel="Back to shift"
      />

      <NewShiftForm
        action={action}
        sites={sites}
        officers={officers}
        initial={{
          siteId: shift.siteId,
          officerId: shift.officerId,
          type: shift.type,
          scheduledStartsAt: toLocalInput(shift.scheduledStartsAt),
          scheduledEndsAt: toLocalInput(shift.scheduledEndsAt),
          checkIntervalMin: shift.checkIntervalMin,
          graceMinutes: shift.graceMinutes,
          notes: shift.notes,
        }}
        submitLabel="Save changes"
        cancelHref={`/shifts/${shift.id}`}
      />
    </div>
  );
}
