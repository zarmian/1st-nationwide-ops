import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { CloseActivityButton } from "../../../dispatch/_components/CloseActivityButton";
import { CancelActivityButton } from "../../../dispatch/_components/CancelActivityButton";
import { RestoreActivityButton } from "../../../dispatch/_components/RestoreActivityButton";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/numbers";

export const dynamic = "force-dynamic";

function fmtFull(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
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
  return formatMoney(n, { currency: currency ?? "GBP" });
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-amber",
  LATE: "chip-amber",
  COMPLETED: "chip-mint",
  MISSED: "chip-red",
  CANCELLED: "chip-red",
};

export default async function PatrolVisitDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireStaff();

  const visit = await prisma.patrolVisit.findUnique({
    where: { id: params.id },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          addressLine: true,
          city: true,
          postcodeFormatted: true,
        },
      },
      officer: { select: { id: true, name: true } },
      handledByPartner: { select: { id: true, name: true } },
      patrolSchedule: {
        select: {
          id: true,
          kind: true,
          frequency: true,
          dayOfWeek: true,
        },
      },
      formSubmissions: {
        select: {
          id: true,
          form: true,
          submittedAt: true,
          review: { select: { id: true, status: true } },
        },
        orderBy: { submittedAt: "desc" },
      },
      job: { select: { id: true, type: true, status: true } },
    },
  });
  if (!visit) notFound();

  const onSiteMins =
    visit.arrivedAt && visit.departedAt
      ? Math.round(
          (visit.departedAt.getTime() - visit.arrivedAt.getTime()) / 60000,
        )
      : null;

  const billed = moneyOrNull(visit.billedAmount, visit.billedCurrency);
  const paid = moneyOrNull(visit.paidAmount, visit.paidCurrency);

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title={`${visit.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol"} visit${visit.site ? ` @ ${visit.site.name}` : ""}`}
        backHref="/patrols"
        backLabel="Patrols"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className={STATUS_TONE[visit.status] ?? "chip-slate"}>
              {visit.status.replace(/_/g, " ").toLowerCase()}
            </span>
            {visit.patrolSchedule?.frequency && (
              <span className="chip-slate">
                {visit.patrolSchedule.frequency.toLowerCase()}
              </span>
            )}
            {onSiteMins != null && (
              <span className="chip-mint">{onSiteMins} min on site</span>
            )}
          </span>
        }
        actions={
          (me.role === "ADMIN" || me.role === "DISPATCHER") ? (
            <>
              {visit.status !== "CANCELLED" && (
                <Link
                  href={`/patrols/visits/${visit.id}/edit`}
                  className="btn-secondary text-sm"
                >
                  Edit
                </Link>
              )}
              {visit.status !== "COMPLETED" && visit.status !== "CANCELLED" && (
                <CloseActivityButton
                  kind="visit"
                  id={visit.id}
                  label={`${visit.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol"} visit @ ${visit.site?.name ?? "site"}`}
                  size="default"
                />
              )}
              {visit.status !== "COMPLETED" && visit.status !== "CANCELLED" && (
                <CancelActivityButton
                  kind="visit"
                  id={visit.id}
                  label={`${visit.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol"} visit @ ${visit.site?.name ?? "site"}`}
                  size="default"
                />
              )}
              {me.role === "ADMIN" && visit.status === "CANCELLED" && (
                <RestoreActivityButton
                  kind="visit"
                  id={visit.id}
                  label={`${visit.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol"} visit @ ${visit.site?.name ?? "site"}`}
                  size="default"
                />
              )}
            </>
          ) : undefined
        }
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Site
          </h2>
          <Link
            href={`/sites/${visit.site.id}/edit`}
            className="font-medium text-brand-navy hover:text-brand-blue-dark text-base"
          >
            {visit.site.name} →
          </Link>
          <div className="text-sm text-slate-600">
            {visit.site.addressLine}
            {visit.site.city ? `, ${visit.site.city}` : ""}
          </div>
          <div className="text-sm font-mono text-slate-500">
            {visit.site.postcodeFormatted}
          </div>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Assigned to
          </h2>
          {visit.handledByPartner ? (
            <div>
              <span className="chip-amber text-[10px]">PARTNER</span>{" "}
              <span className="font-medium text-brand-navy">
                {visit.handledByPartner.name}
              </span>
              <p className="text-xs text-slate-500 mt-1">
                {visit.reportedViaPartnerApp
                  ? "Records in their own app (stub kept for tracking)."
                  : "Fills in our form."}
              </p>
            </div>
          ) : visit.officer ? (
            <Link
              href={`/officers/${visit.officer.id}/edit`}
              className="font-medium text-brand-navy hover:text-brand-blue-dark"
            >
              {visit.officer.name} →
            </Link>
          ) : (
            <span className="text-slate-400 italic">Unassigned</span>
          )}
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Timeline
          </h2>
          <dl className="text-sm space-y-1">
            <Row label="Scheduled">{fmtFull(visit.scheduledAt)}</Row>
            <Row label="Arrived">{fmtFull(visit.arrivedAt)}</Row>
            <Row label="Departed">{fmtFull(visit.departedAt)}</Row>
          </dl>
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            On-site evidence
          </h2>
          <dl className="text-sm space-y-1">
            <Row label="GPS">
              {visit.gpsLat != null && visit.gpsLng != null ? (
                <a
                  href={`https://www.google.com/maps?q=${visit.gpsLat},${visit.gpsLng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-blue-dark hover:underline"
                >
                  {visit.gpsLat.toFixed(5)}, {visit.gpsLng.toFixed(5)} ↗
                </a>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Row>
            <Row label="Photos">
              {visit.photoUrls.length > 0
                ? `${visit.photoUrls.length} attached`
                : "—"}
            </Row>
          </dl>
        </div>
      </div>

      {(visit.patrolSchedule || visit.job || visit.formSubmissions.length > 0) && (
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Linked records
          </h2>
          <ul className="text-sm space-y-1.5">
            {visit.patrolSchedule && (
              <li>
                <span className="text-slate-500">Schedule:</span>{" "}
                <Link
                  href={`/patrols/schedules/${visit.patrolSchedule.id}`}
                  className="text-brand-blue-dark hover:underline"
                >
                  {visit.patrolSchedule.kind === "VPI" ? "VPI" : "Patrol"} ·{" "}
                  {visit.patrolSchedule.frequency.toLowerCase()} →
                </Link>
              </li>
            )}
            {visit.job && (
              <li>
                <span className="text-slate-500">Job:</span>{" "}
                <Link
                  href={`/dispatch/${visit.job.id}`}
                  className="text-brand-blue-dark hover:underline"
                >
                  {visit.job.type.replace(/_/g, " ")} · {visit.job.status}{" "}
                  →
                </Link>
              </li>
            )}
            {visit.formSubmissions.map((s) => (
              <li key={s.id}>
                <span className="text-slate-500">Submission:</span>{" "}
                {s.review?.id ? (
                  <Link
                    href={`/admin/reports/${s.review.id}`}
                    className="text-brand-blue-dark hover:underline"
                  >
                    {s.form.replace(/_/g, " ")} · {fmtFull(s.submittedAt)} →
                  </Link>
                ) : (
                  <span>
                    {s.form.replace(/_/g, " ")} · {fmtFull(s.submittedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {me.role === "ADMIN" && (billed || paid) && (
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            Finance
          </h2>
          <dl className="text-sm space-y-1">
            {billed && (
              <Row label="Billed">
                {billed}
                {visit.billedAt ? ` · ${fmtFull(visit.billedAt)}` : ""}
              </Row>
            )}
            {paid && (
              <Row label="Officer pay">
                {paid}
                {visit.payRateUnit ? ` · ${visit.payRateUnit}` : ""}
                {visit.paidAt ? ` · ${fmtFull(visit.paidAt)}` : ""}
              </Row>
            )}
          </dl>
        </div>
      )}

      <div className="card p-4 space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          Notes
        </h2>
        {visit.notes ? (
          <p className="text-sm whitespace-pre-wrap text-slate-700">
            {visit.notes}
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
