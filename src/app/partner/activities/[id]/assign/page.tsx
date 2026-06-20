import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { AssignOfficerForm } from "./_components/AssignOfficerForm";
import { assignAdminShift, assignAdminJob } from "../../_actions";

export const dynamic = "force-dynamic";

const JOB_TYPE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  ADHOC: "Ad-hoc",
};

/**
 * Lightweight assign-officer page for activities 1NW staff logged with
 * this partner as the handler. Partner picks one of their officers +
 * sets chargeToUs / payToOfficer for the finance breakdown. Site /
 * type / times stay 1NW's (read-only).
 *
 * URL shape:
 *   `/partner/activities/shift-<uuid>/assign` → 1NW-logged Shift row
 *   `/partner/activities/<uuid>/assign`       → 1NW-logged Job row
 */
export default async function AssignAdminActivityPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requirePartner();
  const isShift = params.id.startsWith("shift-");
  const rawId = isShift ? params.id.slice("shift-".length) : params.id;

  const officers = await prisma.partnerOfficer.findMany({
    where: { partnerId: me.partnerId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString("en-GB", {
          timeZone: "Europe/London",
          dateStyle: "short",
          timeStyle: "short",
        })
      : "—";

  if (isShift) {
    const shift = await prisma.shift.findFirst({
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
    });
    if (!shift) notFound();

    return (
      <div className="space-y-4">
        <PageHeader
          title="Assign officer"
          backHref="/partner/activities"
          backLabel="Activities"
          subtitle={
            <>
              1NW logged this shift with you as the handler. Pick which
              of your officers attended and set your rates so the
              finance dashboard reflects it.
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
            {shift.site?.customer?.name
              ? `${shift.site.customer.name} · `
              : ""}
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

  // Job branch.
  const job = await prisma.job.findFirst({
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
      customer: { select: { name: true } },
      handledByPartnerOfficer: { select: { id: true, name: true } },
    },
  });
  if (!job) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assign officer"
        backHref="/partner/activities"
        backLabel="Activities"
        subtitle={
          <>
            1NW logged this callout with you as the handler. Pick which
            of your officers attended and set your rates so the finance
            dashboard reflects it.
          </>
        }
      />

      <div className="card p-4 space-y-1">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Callout
        </div>
        <div className="text-sm">
          <span className="font-medium text-brand-navy">
            {JOB_TYPE_LABEL[job.type] ?? job.type.replace(/_/g, " ")}
          </span>{" "}
          ·{" "}
          <span>
            {job.site?.code ? `${job.site.code} · ` : ""}
            {job.site?.name ?? "—"}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {job.customer?.name ??
            job.site?.customer?.name ??
            ""}
          {(job.customer?.name || job.site?.customer?.name) && " · "}
          {fmt(job.scheduledFor ?? job.startedAt ?? job.completedAt)}
        </div>
      </div>

      <AssignOfficerForm
        action={assignAdminJob.bind(null, job.id)}
        officers={officers}
        initial={{
          partnerOfficerId: job.handledByPartnerOfficerId,
          chargeToUs: Number(job.partnerChargeToUsAmount ?? 0),
          payToOfficer: Number(job.partnerOfficerPayAmount ?? 0),
          notes: job.notes,
        }}
      />
    </div>
  );
}
