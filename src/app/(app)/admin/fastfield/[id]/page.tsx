import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { FastFieldAnswers } from "@/components/FastFieldAnswers";
import { formatDateTime, formatTime } from "@/lib/dates";
import { extractFacts, type FastFieldAnswer } from "@/lib/fastfield";
import { activitiesNearReport } from "@/lib/fastfieldImport";
import { ReportStatusChip, activityLabel } from "../_components/labels";
import { CreateJobForm, IgnoreButton, LinkButton } from "../_components/ReportActions";

export const dynamic = "force-dynamic";

export default async function FastFieldReportPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { site?: string };
}) {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const report = await prisma.fastFieldReport.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      note: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      siteText: true,
      officerText: true,
      answers: true,
      photoUrls: true,
      siteId: true,
      form: { select: { name: true, customerId: true, jobType: true } },
      site: { select: { id: true, name: true } },
      job: { select: { id: true, type: true, status: true } },
      patrolVisit: { select: { id: true, scheduledAt: true } },
      shift: { select: { id: true } },
      formSubmission: { select: { review: { select: { id: true } } } },
    },
  });
  if (!report) notFound();

  const facts = extractFacts({
    submittedAt: report.submittedAt,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    answers: report.answers as unknown as FastFieldAnswer[],
  });
  const open = report.status === "UNMATCHED" || report.status === "IGNORED";

  // Linking by hand: the activities near the report's time at a chosen site,
  // from the form's client's sites (or everyone's, grouped by client).
  const sites = open
    ? await prisma.site.findMany({
        where: { active: true, ...(report.form.customerId ? { customerId: report.form.customerId } : {}) },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          postcodeFormatted: true,
          customer: { select: { name: true } },
          partner: { select: { name: true } },
        },
      })
    : [];
  const groups = new Map<string, typeof sites>();
  for (const s of sites) {
    const owner = s.customer?.name ?? s.partner?.name ?? "No client";
    groups.set(owner, [...(groups.get(owner) ?? []), s]);
  }
  const groupNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const chosenSiteId =
    searchParams.site && sites.some((s) => s.id === searchParams.site)
      ? searchParams.site
      : report.siteId && sites.some((s) => s.id === report.siteId)
        ? report.siteId
        : null;
  const nearby = open && chosenSiteId ? await activitiesNearReport(report.id, chosenSiteId) : [];
  const reviewId = report.formSubmission?.review?.id ?? null;

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title={`${report.site?.name ?? report.siteText ?? "FastField report"}`}
        backHref="/admin/fastfield"
        backLabel="FastField"
        subtitle={
          <>
            {report.form.name.trim()} · submitted {formatDateTime(report.submittedAt)}
            {report.officerText ? ` by ${facts.officerName ?? report.officerText}` : ""}
          </>
        }
        actions={<ReportStatusChip status={report.status} />}
      />

      <div className="card p-4 space-y-1 text-sm">
        {report.note && <p className="text-slate-800">{report.note}</p>}
        <p className="text-slate-500">
          Site as typed: {report.siteText ?? "—"} · Arrived {formatDateTime(facts.arrivedAt)} · Left{" "}
          {formatDateTime(facts.departedAt)}
          {facts.lat != null && facts.lng != null && (
            <>
              {" "}
              ·{" "}
              <a
                href={`https://www.google.com/maps?q=${facts.lat},${facts.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-blue-dark hover:underline"
              >
                where the phone was
              </a>
            </>
          )}
        </p>
        {!open && (
          <p className="flex flex-wrap gap-4 pt-1">
            {report.job && (
              <Link href={`/dispatch/${report.job.id}`} className="text-brand-blue-dark hover:underline">
                Open the {activityLabel(report.job.type).toLowerCase()} →
              </Link>
            )}
            {report.patrolVisit && (
              <Link
                href={`/patrols/visits/${report.patrolVisit.id}`}
                className="text-brand-blue-dark hover:underline"
              >
                Open the patrol visit →
              </Link>
            )}
            {report.shift && (
              <Link href={`/shifts/${report.shift.id}`} className="text-brand-blue-dark hover:underline">
                Open the static shift →
              </Link>
            )}
            {reviewId && (
              <Link href={`/admin/reports/${reviewId}`} className="text-brand-blue-dark hover:underline">
                Open the attached report →
              </Link>
            )}
          </p>
        )}
      </div>

      {open && (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-brand-navy">Link it to an activity</h2>
              <p className="text-sm text-slate-500">
                Pick the site, then the activity this report is about — or create the job if
                nobody logged it.
              </p>
            </div>
            <IgnoreButton reportId={report.id} ignored={report.status === "IGNORED"} />
          </div>

          <form method="get" className="flex flex-wrap items-end gap-2">
            <label htmlFor="ff-site" className="block">
              <span className="label">Site</span>
              <select
                id="ff-site"
                name="site"
                defaultValue={chosenSiteId ?? ""}
                className="input w-auto max-w-[22rem]"
              >
                <option value="">— pick a site —</option>
                {groupNames.map((g) => (
                  <optgroup key={g} label={g}>
                    {groups.get(g)!.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.postcodeFormatted ? ` (${s.postcodeFormatted})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              Show activities
            </button>
          </form>

          {chosenSiteId && (
            <>
              {nearby.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No shift on, and nothing within 3 hours of {formatDateTime(facts.when)}, at this
                  site.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {nearby.map((a) => (
                    <li key={a.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium text-slate-900">{activityLabel(a.type)}</span>
                      <span className="text-slate-500">
                        {a.kind === "shift" && a.until
                          ? `${formatDateTime(a.at)}–${formatTime(a.until)} · on at the time`
                          : `${formatDateTime(a.at)} · ${a.minutesApart} min ${
                              a.at.getTime() < facts.when.getTime() ? "before" : "after"
                            }`}
                      </span>
                      {a.taken && (
                        <span className="text-xs text-amber-800">already has a FastField report</span>
                      )}
                      <Link
                        href={
                          a.kind === "job"
                            ? `/dispatch/${a.id}`
                            : a.kind === "visit"
                              ? `/patrols/visits/${a.id}`
                              : `/shifts/${a.id}`
                        }
                        className="text-xs text-brand-blue-dark hover:underline"
                      >
                        view
                      </Link>
                      <span className="ml-auto">
                        <LinkButton reportId={report.id} kind={a.kind} activityId={a.id} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <CreateJobForm
                reportId={report.id}
                siteId={chosenSiteId}
                defaultType={facts.visitType ?? report.form.jobType}
              />
            </>
          )}
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-semibold text-brand-navy mb-3">The report</h2>
        <FastFieldAnswers answers={report.answers} photoUrls={report.photoUrls} />
      </div>
    </div>
  );
}
