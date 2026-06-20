import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { AssignOfficerForm } from "./_components/AssignOfficerForm";
import { assignAdminShift } from "../../_actions";

export const dynamic = "force-dynamic";

/**
 * Lightweight assign-officer page for shifts 1NW staff logged with this
 * partner as the handler. Partner picks one of their officers + sets
 * chargeToUs / payToOfficer for the finance breakdown. Site / type /
 * times stay 1NW's (read-only).
 *
 * Url shape: `/partner/activities/shift-<uuid>/assign`. We require the
 * `shift-` prefix to disambiguate from job edits.
 */
export default async function AssignAdminShiftPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requirePartner();
  if (!params.id.startsWith("shift-")) notFound();
  const rawId = params.id.slice("shift-".length);

  const [shift, officers] = await Promise.all([
    prisma.shift.findFirst({
      where: {
        id: rawId,
        handledByPartnerId: me.partnerId,
        recordedByPartner: false,
      },
      include: {
        site: {
          select: {
            name: true,
            code: true,
            postcodeFormatted: true,
            customer: { select: { name: true } },
          },
        },
        handledByPartnerOfficer: { select: { id: true, name: true } },
      },
    }),
    prisma.partnerOfficer.findMany({
      where: { partnerId: me.partnerId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!shift) notFound();

  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString("en-GB", {
          timeZone: "Europe/London",
          dateStyle: "short",
          timeStyle: "short",
        })
      : "—";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assign officer"
        backHref="/partner/activities"
        backLabel="Activities"
        subtitle={
          <>
            1NW logged this shift with you as the handler. Pick which of
            your officers attended and set your rates so the finance
            dashboard reflects it.
          </>
        }
      />

      <div className="card p-4 space-y-1">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Shift
        </div>
        <div className="text-sm">
          <span className="font-medium text-brand-navy">
            {shift.type === "STATIC_GUARDING"
              ? "Static guarding"
              : "Dog handler"}
          </span>{" "}
          ·{" "}
          <span>
            {shift.site?.code ? `${shift.site.code} · ` : ""}
            {shift.site?.name ?? "—"}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {shift.site?.customer?.name ? `${shift.site.customer.name} · ` : ""}
          {fmt(shift.actualStartedAt ?? shift.scheduledStartsAt)} →{" "}
          {fmt(shift.actualEndedAt ?? shift.scheduledEndsAt)}
        </div>
      </div>

      <AssignOfficerForm
        action={assignAdminShift.bind(null, shift.id)}
        officers={officers}
        initial={{
          partnerOfficerId: shift.handledByPartnerOfficerId,
          chargeToUs: Number(shift.partnerChargeToUsAmount ?? 0),
          payToOfficer: Number(shift.partnerOfficerPayAmount ?? 0),
          notes: shift.notes,
        }}
      />
    </div>
  );
}
