import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { PartnerActivityForm } from "../../_components/PartnerActivityForm";
import { updatePartnerActivity } from "../../_actions";
import { formatUkDateTimeLocal } from "@/lib/dates";
import { CancelActivityButton } from "../../_components/CancelActivityButton";

export const dynamic = "force-dynamic";

/**
 * Edit a partner-recorded activity. `[id]` is either a raw Job UUID
 * (kind=JOB) or "shift-<uuid>" (kind=SHIFT) — same encoding the
 * create action redirects to. Either way, we scope by partnerId +
 * recordedByPartner = true and bail to notFound() if not theirs.
 */
export default async function EditPartnerActivityPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requirePartner();
  const isShift = params.id.startsWith("shift-");
  const rawId = isShift ? params.id.slice("shift-".length) : params.id;

  const [customers, sites, officers, rates, row, shift] = await Promise.all([
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.site.findMany({
      where: { active: true, customerId: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, customerId: true },
    }),
    prisma.partnerOfficer.findMany({
      where: { partnerId: me.partnerId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partnerRate.findMany({
      where: { partnerId: me.partnerId },
      select: { service: true, chargeToUs: true, payToOfficer: true, unit: true },
    }),
    isShift
      ? Promise.resolve(null)
      : prisma.job.findFirst({
          where: {
            id: rawId,
            handledByPartnerId: me.partnerId,
            recordedByPartner: true,
          },
        }),
    isShift
      ? prisma.shift.findFirst({
          where: {
            id: rawId,
            handledByPartnerId: me.partnerId,
            recordedByPartner: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!row && !shift) notFound();

  const action = updatePartnerActivity.bind(null, params.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit activity"
        backHref="/partner/activities"
        backLabel="Activities"
        actions={
          <CancelActivityButton
            encodedId={params.id}
            kind={isShift ? "SHIFT" : "JOB"}
          />
        }
      />
      {row && (
        <PartnerActivityForm
          action={action}
          submitLabel="Save changes"
          initial={{
            encodedId: params.id,
            kind: "JOB",
            type: row.type,
            customerId: row.customerId ?? "",
            siteId: row.siteId ?? "",
            partnerOfficerId: row.handledByPartnerOfficerId,
            chargeToUs: Number(row.partnerChargeToUsAmount ?? 0),
            payToOfficer: Number(row.partnerOfficerPayAmount ?? 0),
            notes: row.notes,
            scheduledFor: formatUkDateTimeLocal(row.scheduledFor) ?? null,
            completedAt: formatUkDateTimeLocal(row.completedAt) ?? null,
          }}
          customers={customers}
          sites={sites.map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code,
            customerId: s.customerId ?? "",
          }))}
          officers={officers}
          rates={rates.map((r) => ({
            service: r.service,
            chargeToUs: Number(r.chargeToUs),
            payToOfficer: Number(r.payToOfficer),
            unit: r.unit,
          }))}
        />
      )}
      {shift && (
        <PartnerActivityForm
          action={action}
          submitLabel="Save changes"
          initial={{
            encodedId: params.id,
            kind: "SHIFT",
            type: shift.type,
            customerId:
              (
                await prisma.site.findUnique({
                  where: { id: shift.siteId },
                  select: { customerId: true },
                })
              )?.customerId ?? "",
            siteId: shift.siteId,
            partnerOfficerId: shift.handledByPartnerOfficerId,
            chargeToUs: Number(shift.partnerChargeToUsAmount ?? 0),
            payToOfficer: Number(shift.partnerOfficerPayAmount ?? 0),
            notes: shift.notes,
            startedAt:
              formatUkDateTimeLocal(shift.actualStartedAt ?? shift.scheduledStartsAt) ??
              null,
            endedAt:
              formatUkDateTimeLocal(shift.actualEndedAt ?? shift.scheduledEndsAt) ??
              null,
          }}
          customers={customers}
          sites={sites.map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code,
            customerId: s.customerId ?? "",
          }))}
          officers={officers}
          rates={rates.map((r) => ({
            service: r.service,
            chargeToUs: Number(r.chargeToUs),
            payToOfficer: Number(r.payToOfficer),
            unit: r.unit,
          }))}
        />
      )}
    </div>
  );
}
