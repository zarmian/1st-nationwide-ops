import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { reassignJob } from "../../patrols/_actions";
import { QuickReassignJob } from "../../patrols/_components/QuickReassign";
import { CancelJobButton } from "../_components/CancelJobButton";
import { RestoreJobButton } from "../_components/RestoreJobButton";

export const dynamic = "force-dynamic";

function relativeTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function moneyOrNull(
  amount: { toString: () => string } | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amount == null) return null;
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return null;
  const sym = currency === "GBP" ? "£" : (currency ?? "");
  return `${sym}${n.toFixed(2)}`;
}

function STATUS_TONE(status: string): string {
  switch (status) {
    case "CLOSED":
    case "SENT_TO_CLIENT":
      return "chip-mint";
    case "CANCELLED":
      return "chip-red";
    case "REVIEW_PENDING":
    case "SUBMITTED":
      return "chip-amber";
    default:
      return "chip-slate";
  }
}

export default async function JobDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireStaff();

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          postcodeFormatted: true,
          addressLine: true,
          city: true,
        },
      },
      customer: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      handledByPartner: { select: { id: true, name: true } },
      cancelledBy: { select: { name: true } },
      alarmEvent: {
        select: { id: true, source: true, zone: true, priority: true },
      },
      patrolVisit: {
        select: {
          id: true,
          scheduledAt: true,
          arrivedAt: true,
          departedAt: true,
          status: true,
        },
      },
      shift: { select: { id: true, type: true } },
      onboardingPipeline: { select: { id: true } },
      formSubmissions: {
        select: {
          id: true,
          form: true,
          submittedAt: true,
          review: { select: { id: true, status: true } },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });
  if (!job) notFound();

  const assignableOfficers = await prisma.user.findMany({
    where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const isPreStart = job.status === "OPEN" || job.status === "ASSIGNED";
  const isClosed =
    job.status === "CLOSED" ||
    job.status === "SENT_TO_CLIENT" ||
    job.status === "CANCELLED";

  const billed = moneyOrNull(job.billedAmount, job.billedCurrency);
  const paid = moneyOrNull(job.paidAmount, job.paidCurrency);

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <Link
          href="/dispatch"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Dispatch
        </Link>
        <div className="flex items-center justify-between mt-1 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy">
              {job.type.replace(/_/g, " ")}
              {job.site ? ` @ ${job.site.name}` : ""}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={STATUS_TONE(job.status)}>
                {job.status.replace(/_/g, " ")}
              </span>
              <span
                className={
                  job.priority === "HIGH" ? "chip-red" : "chip-slate"
                }
              >
                {job.priority}
              </span>
              <span className="chip-slate">
                {job.source.replace(/_/g, " ")}
              </span>
              {job.reportedViaPartnerApp && (
                <span className="chip-amber">VIA PARTNER APP</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {me.role === "ADMIN" && job.status === "CANCELLED" && (
              <RestoreJobButton
                jobId={job.id}
                jobLabel={`${job.type.replace(/_/g, " ")} @ ${job.site?.name ?? "site"}`}
              />
            )}
            {me.role === "ADMIN" && job.status !== "CANCELLED" && (
              <Link href={`/dispatch/${job.id}/edit`} className="btn-secondary text-sm">
                Edit
              </Link>
            )}
            {!isClosed && (
              <CancelJobButton
                jobId={job.id}
                jobLabel={`${job.type.replace(/_/g, " ")} @ ${job.site?.name ?? "site"}`}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Site
          </h2>
          {job.site ? (
            <div className="space-y-1">
              <Link
                href={`/sites/${job.site.id}/edit`}
                className="font-medium text-brand-navy hover:text-brand-mint-dark text-base"
              >
                {job.site.name} →
              </Link>
              <div className="text-sm text-slate-600">
                {job.site.addressLine}
                {job.site.city ? `, ${job.site.city}` : ""}
              </div>
              <div className="text-sm font-mono text-slate-500">
                {job.site.postcodeFormatted}
              </div>
            </div>
          ) : (
            <span className="text-slate-400 italic">No site linked</span>
          )}
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Who it's for
          </h2>
          <dl className="text-sm space-y-1">
            <Row label="Customer">
              {job.customer ? (
                <Link
                  href={`/admin/customers/${job.customer.id}`}
                  className="text-brand-navy hover:text-brand-mint-dark"
                >
                  {job.customer.name}
                </Link>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Row>
            <Row label="Partner">
              {job.partner ? (
                <Link
                  href={`/admin/partners/${job.partner.id}`}
                  className="text-brand-navy hover:text-brand-mint-dark"
                >
                  {job.partner.name}
                </Link>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Row>
          </dl>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            {job.handledByPartner ? "Handed to partner" : "Assigned officer"}
          </h2>
          {job.handledByPartner ? (
            <div className="text-sm">
              <div className="font-medium text-brand-navy">
                {job.handledByPartner.name}
              </div>
              {job.handedOffAt && (
                <div className="text-xs text-slate-500 mt-1">
                  Given to them: {relativeTime(job.handedOffAt)}
                </div>
              )}
              {job.externalResponder && (
                <div className="text-xs text-slate-500 mt-0.5">
                  Their officer: {job.externalResponder}
                </div>
              )}
              {job.partnerReportRef && (
                <div className="text-xs text-slate-500 mt-0.5">
                  Their report ref: {job.partnerReportRef}
                </div>
              )}
            </div>
          ) : isPreStart ? (
            <QuickReassignJob
              jobId={job.id}
              currentOfficerId={job.assignedTo?.id ?? null}
              officers={assignableOfficers}
              reassign={reassignJob}
            />
          ) : (
            <div className="text-sm">
              {job.assignedTo ? (
                <Link
                  href={`/officers/${job.assignedTo.id}/edit`}
                  className="font-medium text-brand-navy hover:text-brand-mint-dark"
                >
                  {job.assignedTo.name}
                </Link>
              ) : (
                <span className="text-slate-400 italic">Unassigned</span>
              )}
              {job.externalResponder && (
                <div className="text-xs text-slate-500 mt-1">
                  External: {job.externalResponder}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Timeline
          </h2>
          <dl className="text-sm space-y-1">
            <Row label="Created">{relativeTime(job.createdAt)}</Row>
            <Row label="Scheduled">{relativeTime(job.scheduledFor)}</Row>
            <Row label="Started">{relativeTime(job.startedAt)}</Row>
            <Row label="Completed">{relativeTime(job.completedAt)}</Row>
            {job.cancelledAt && (
              <Row label="Cancelled">
                {relativeTime(job.cancelledAt)}
                {job.cancelledBy ? ` by ${job.cancelledBy.name}` : ""}
              </Row>
            )}
          </dl>
        </div>
      </div>

      {(job.alarmEvent ||
        job.patrolVisit ||
        job.shift ||
        job.onboardingPipeline ||
        job.formSubmissions.length > 0 ||
        job.partnerReportRef) && (
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Linked records
          </h2>
          <ul className="text-sm space-y-1.5">
            {job.alarmEvent && (
              <li>
                <span className="text-slate-500">Alarm event:</span>{" "}
                <span className="font-mono text-xs">
                  {job.alarmEvent.source}
                </span>
                {job.alarmEvent.zone ? ` · zone ${job.alarmEvent.zone}` : ""}{" "}
                ·{" "}
                <span className="chip-slate">{job.alarmEvent.priority}</span>
              </li>
            )}
            {job.patrolVisit && (
              <li>
                <span className="text-slate-500">Patrol visit:</span>{" "}
                <span className="chip-slate text-[10px] mr-1">
                  {job.patrolVisit.status}
                </span>
                scheduled {relativeTime(job.patrolVisit.scheduledAt)}
                {job.patrolVisit.arrivedAt
                  ? ` · arrived ${relativeTime(job.patrolVisit.arrivedAt)}`
                  : ""}
                {job.patrolVisit.departedAt
                  ? ` · departed ${relativeTime(job.patrolVisit.departedAt)}`
                  : ""}
              </li>
            )}
            {job.shift && (
              <li>
                <span className="text-slate-500">Shift:</span>{" "}
                {job.shift.type.replace(/_/g, " ")}
              </li>
            )}
            {job.onboardingPipeline && (
              <li>
                <span className="text-slate-500">Onboarding:</span>{" "}
                <Link
                  href={`/onboarding/${job.onboardingPipeline.id}`}
                  className="text-brand-mint-dark hover:underline"
                >
                  open pipeline →
                </Link>
              </li>
            )}
            {job.formSubmissions.map((fs) => (
              <li key={fs.id}>
                <span className="text-slate-500">Submission:</span>{" "}
                {fs.review ? (
                  <Link
                    href={`/admin/reports/${fs.review.id}`}
                    className="text-brand-mint-dark hover:underline"
                  >
                    {fs.form.replace(/_/g, " ")} ·{" "}
                    {relativeTime(fs.submittedAt)} →
                  </Link>
                ) : (
                  <span className="text-slate-700">
                    {fs.form.replace(/_/g, " ")} ·{" "}
                    {relativeTime(fs.submittedAt)}
                    <span className="ml-2 text-xs text-slate-500">
                      (no review queue entry)
                    </span>
                  </span>
                )}
              </li>
            ))}
            {job.partnerReportRef && (
              <li>
                <span className="text-slate-500">Partner report ref:</span>{" "}
                <span className="font-mono text-xs">
                  {job.partnerReportRef}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      {(billed || paid) && (
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Finance
          </h2>
          <dl className="text-sm space-y-1">
            {billed && (
              <Row label="Billed">
                {billed}
                {job.billedAt ? ` · ${relativeTime(job.billedAt)}` : ""}
              </Row>
            )}
            {paid && (
              <Row label="Officer pay">
                {paid}
                {job.payRateUnit ? ` · ${job.payRateUnit}` : ""}
                {job.paidAt ? ` · ${relativeTime(job.paidAt)}` : ""}
              </Row>
            )}
          </dl>
        </div>
      )}

      <div className="card p-4 space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          Notes
        </h2>
        {job.notes ? (
          <p className="text-sm whitespace-pre-wrap text-slate-700">
            {job.notes}
          </p>
        ) : (
          <p className="text-sm text-slate-400 italic">No notes.</p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500 w-28 shrink-0">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
