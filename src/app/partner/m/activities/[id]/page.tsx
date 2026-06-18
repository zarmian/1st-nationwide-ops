import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePartnerOfficer } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatUkDateTimeLocal } from "@/lib/dates";
import { AssignedActivityForm } from "../_components/AssignedActivityForm";
import { MarkDoneButton } from "../_components/MarkDoneButton";
import { updateAssignedActivity } from "../_actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

function fmtFull(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AssignedActivityPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requirePartnerOfficer();
  const isShift = params.id.startsWith("shift-");
  const rawId = isShift ? params.id.slice("shift-".length) : params.id;

  const job = isShift
    ? null
    : await prisma.job.findFirst({
        where: {
          id: rawId,
          handledByPartnerOfficerId: me.partnerOfficerId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          scheduledFor: true,
          startedAt: true,
          completedAt: true,
          notes: true,
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              addressLine: true,
              city: true,
              postcodeFormatted: true,
            },
          },
          customer: { select: { name: true } },
        },
      });
  const shift = isShift
    ? await prisma.shift.findFirst({
        where: {
          id: rawId,
          handledByPartnerOfficerId: me.partnerOfficerId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          actualStartedAt: true,
          actualEndedAt: true,
          notes: true,
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              addressLine: true,
              city: true,
              postcodeFormatted: true,
              customer: { select: { name: true } },
            },
          },
        },
      })
    : null;

  if (!job && !shift) notFound();

  const action = updateAssignedActivity.bind(null, params.id);
  const kind = isShift ? "SHIFT" : "JOB";
  const isDone = isShift ? !!shift?.actualEndedAt : !!job?.completedAt;
  const typeLabel = isShift
    ? (KIND_LABEL[shift!.type] ?? shift!.type)
    : (KIND_LABEL[job!.type] ?? job!.type.replace(/_/g, " "));
  const site = isShift ? shift!.site : job!.site;
  const customer = isShift ? shift!.site?.customer : job!.customer;

  return (
    <div className="space-y-4">
      <PageHeader
        title={typeLabel}
        backHref="/partner/m/today"
        backLabel="Today"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="chip-slate text-[10px]">{typeLabel}</span>
            {isDone && <span className="chip-mint text-[10px]">Done</span>}
          </span>
        }
        actions={
          !isDone ? (
            <MarkDoneButton encodedId={params.id} />
          ) : undefined
        }
      />

      <div className="card p-4 space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-slate-500">
          Site
        </h2>
        <div className="font-medium text-brand-navy">
          {site?.code ? `${site.code} · ` : ""}
          {site?.name ?? "—"}
        </div>
        {site?.addressLine && (
          <div className="text-sm text-slate-600">
            {site.addressLine}
            {site.city ? `, ${site.city}` : ""}
          </div>
        )}
        {site?.postcodeFormatted && (
          <div className="text-sm font-mono text-slate-500">
            {site.postcodeFormatted}
          </div>
        )}
        {customer && (
          <div className="text-xs text-slate-500 mt-1">
            Customer: <span className="text-slate-700">{customer.name}</span>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-slate-500">
          Scheduled
        </h2>
        {isShift ? (
          <div className="text-sm">
            <div>
              <span className="text-slate-500">Starts:</span>{" "}
              <span className="text-brand-navy">
                {fmtFull(shift!.scheduledStartsAt)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Ends:</span>{" "}
              <span className="text-brand-navy">
                {fmtFull(shift!.scheduledEndsAt)}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm">
            <div>
              <span className="text-slate-500">Scheduled for:</span>{" "}
              <span className="text-brand-navy">
                {fmtFull(job!.scheduledFor)}
              </span>
            </div>
          </div>
        )}
      </div>

      <AssignedActivityForm
        action={action}
        kind={kind}
        initial={
          isShift
            ? {
                kind: "SHIFT",
                startedAt: formatUkDateTimeLocal(shift!.actualStartedAt) ?? null,
                endedAt: formatUkDateTimeLocal(shift!.actualEndedAt) ?? null,
                notes: shift!.notes,
              }
            : {
                kind: "JOB",
                arrivedAt: formatUkDateTimeLocal(job!.startedAt) ?? null,
                departedAt: formatUkDateTimeLocal(job!.completedAt) ?? null,
                notes: job!.notes,
              }
        }
      />
    </div>
  );
}
