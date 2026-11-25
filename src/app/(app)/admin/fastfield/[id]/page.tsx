import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { FastFieldAnswers } from "@/components/FastFieldAnswers";
import { formatDate, formatDateTime } from "@/lib/dates";
import {
  SHIFT_GRACE_MIN,
  extractFacts,
  reportSpan,
  shiftHoursText,
  spanText,
  type FastFieldAnswer,
} from "@/lib/fastfield";
import { activitiesNearReport, checkReportOnShift } from "@/lib/fastfieldImport";
import {
  HAND_LINK_REACH_DAYS,
  activityWords,
  besideReportText,
  groupSitesForLinking,
  handLinkMarkers,
  handLinkWindow,
  linkOutcome,
  otherClientWarning,
  siteOwner,
  type LinkSite,
} from "@/lib/fastfieldHandLink";
import { ReportStatusChip } from "../_components/labels";
import { CreateJobForm, IgnoreButton, LinkButton, UnlinkButton } from "../_components/ReportActions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page an activity opens on. */
function activityHref(kind: "job" | "visit" | "shift", id: string): string {
  return kind === "job" ? `/dispatch/${id}` : kind === "visit" ? `/patrols/visits/${id}` : `/shifts/${id}`;
}

export default async function FastFieldReportPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { site?: string; day?: string; closed?: string };
}) {
  await requireAdminPage();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const report = await prisma.fastFieldReport.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      linkedByHand: true,
      note: true,
      submittedAt: true,
      startedAt: true,
      finishedAt: true,
      siteText: true,
      officerText: true,
      answers: true,
      photoUrls: true,
      siteId: true,
      form: {
        select: { name: true, jobType: true, customer: { select: { id: true, name: true } } },
      },
      site: {
        select: {
          id: true,
          name: true,
          customer: { select: { id: true, name: true } },
          partner: { select: { id: true, name: true } },
        },
      },
      job: { select: { id: true, type: true, status: true } },
      patrolVisit: { select: { id: true, scheduledAt: true, patrolSchedule: { select: { kind: true } } } },
      shift: {
        select: {
          id: true,
          officerId: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          actualStartedAt: true,
          actualEndedAt: true,
        },
      },
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
  const span = reportSpan(facts);
  // On a shift: does the report fit inside it?
  const onShift =
    report.shift && report.status === "LINKED" ? checkReportOnShift(report, report.shift) : null;

  // On a job or visit (or the job made from it): Unlink undoes what the link did.
  const attached = report.job
    ? activityWords("job", report.job.type)
    : report.patrolVisit
      ? activityWords("visit", report.patrolVisit.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL")
      : null;
  const unlinkFrom =
    report.status === "CREATED" && report.job
      ? ("created" as const)
      : report.status === "LINKED" && report.job
        ? ("job" as const)
        : report.status === "LINKED" && report.patrolVisit
          ? ("visit" as const)
          : null;
  const lostActivity = !open && !report.job && !report.patrolVisit && !report.shift;

  // Linking by hand: any site of any client (closed ones on request), and
  // everything there around the report's time or on a day picked.
  const showClosed = searchParams.closed === "1";
  const askedSite = searchParams.site && UUID.test(searchParams.site) ? searchParams.site : null;
  let sites: (LinkSite & { postcodeFormatted: string })[] = [];
  let closedCount = 0;
  if (open) {
    const keep = [askedSite, report.siteId].filter((x): x is string => !!x);
    [sites, closedCount] = await Promise.all([
      prisma.site.findMany({
        where: showClosed ? {} : { OR: [{ active: true }, { id: { in: keep } }] },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          postcodeFormatted: true,
          active: true,
          customer: { select: { id: true, name: true } },
          partner: { select: { id: true, name: true } },
        },
      }),
      prisma.site.count({ where: { active: false } }),
    ]);
  }
  const formClient = report.form.customer;
  const matched = report.site ? { name: report.site.name, owner: siteOwner(report.site) } : null;
  const groups = groupSitesForLinking(sites, [formClient ? `c:${formClient.id}` : null, matched?.owner?.key]);
  const chosen =
    sites.find((s) => s.id === askedSite) ?? sites.find((s) => s.id === report.siteId) ?? null;
  const chosenOwner = chosen ? siteOwner(chosen) : null;
  const listWindow = handLinkWindow(span, searchParams.day);
  const list =
    open && chosen ? await activitiesNearReport(report.id, chosen.id, listWindow) : { rows: [], more: false };
  const rows = list.rows.map((a) => {
    const words = activityWords(a.kind, a.type);
    const when =
      a.kind === "shift" && a.until ? shiftHoursText({ start: a.at, end: a.until }) : formatDateTime(a.at);
    const beside =
      a.kind === "shift"
        ? a.outside
          ? `outside the shift: the report ${a.outside}`
          : "the report fits"
        : besideReportText({ minutes: a.minutesApart, side: a.side ?? "during" });
    const outcome = linkOutcome({
      kind: a.kind,
      noun: words.noun,
      cancelled: a.status === "CANCELLED",
      marksDone: a.marksDone,
      standsForShift: a.kind === "job" && (a.type === "STATIC_GUARDING_SHIFT" || a.type === "DOG_HANDLER_SHIFT"),
    });
    return {
      a,
      words,
      when,
      beside,
      markers: handLinkMarkers(a),
      outcome,
      warning: otherClientWarning({ what: words.noun, owner: chosenOwner, formClient, matchedSite: matched }),
    };
  });
  const reviewId = report.formSubmission?.review?.id ?? null;

  /** This page with the site / day / closed-sites choice changed. */
  const hrefWith = (change: { day?: string | null; closed?: boolean }) => {
    const q = new URLSearchParams();
    if (chosen) q.set("site", chosen.id);
    const day = change.day === undefined ? listWindow.day : change.day;
    if (day) q.set("day", day);
    if (change.closed ?? showClosed) q.set("closed", "1");
    const s = q.toString();
    return `/admin/fastfield/${report.id}${s ? `?${s}` : ""}`;
  };
  const dayText = listWindow.day ? formatDate(listWindow.from) : null;

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
        {report.note && <p className="text-slate-800 break-words">{report.note}</p>}
        <p className="text-slate-500">
          Site as typed: {report.siteText ?? "—"} · Report time {spanText(span)} · Arrived{" "}
          {formatDateTime(facts.arrivedAt)} · Left {formatDateTime(facts.departedAt)}
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            {report.job && attached && (
              <Link href={`/dispatch/${report.job.id}`} className="text-brand-blue-dark hover:underline">
                Open the {attached.noun} →
              </Link>
            )}
            {report.patrolVisit && attached && (
              <Link
                href={`/patrols/visits/${report.patrolVisit.id}`}
                className="text-brand-blue-dark hover:underline"
              >
                Open the {attached.noun} →
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
            {lostActivity && (
              <span className="text-amber-800">What it was attached to has since been deleted.</span>
            )}
            {unlinkFrom && attached && (
              <UnlinkButton
                reportId={report.id}
                from={unlinkFrom}
                what={`the ${attached.noun}${report.site ? ` at ${report.site.name}` : ""}`}
                label={`Unlink from the ${attached.noun}`}
                className="btn btn-secondary"
              />
            )}
          </div>
        )}
      </div>

      {onShift && report.shift && (
        <div
          className={
            "card p-4 flex flex-wrap items-center justify-between gap-3 text-sm " +
            (onShift.outside ? "border-amber-300 bg-amber-50" : "")
          }
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">
              On the static shift {shiftHoursText(onShift.shift)}
              {report.linkedByHand ? " (linked by hand)" : ""}
            </p>
            {onShift.outside && report.linkedByHand ? (
              <p className="text-amber-900">
                This report ({spanText(onShift.span)}) {onShift.outside}, but it was linked here by
                hand, so the robot leaves it on this shift.
              </p>
            ) : onShift.outside ? (
              <p className="text-amber-900">
                This report ({spanText(onShift.span)}) {onShift.outside}, more than the{" "}
                {SHIFT_GRACE_MIN} minutes allowed. Every 5 minutes the robot moves a report like this to
                a shift at the site it fits, or takes it off (one already sent to the client stays for
                you to sort out). To do it now, unlink it and link it to the right activity.
              </p>
            ) : (
              <p className="text-slate-500">The report fits the shift.</p>
            )}
          </div>
          <UnlinkButton
            reportId={report.id}
            label="Unlink from this shift"
            className={onShift.outside ? "btn btn-primary" : "btn btn-secondary"}
          />
        </div>
      )}

      {open && (
        <div className="card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-brand-navy">Link it to an activity</h2>
              <p className="text-sm text-slate-500">
                Pick the site, then the activity this report is about. Everything there from{" "}
                {HAND_LINK_REACH_DAYS} days before the report to {HAND_LINK_REACH_DAYS} days after is
                listed, nearest first, or pick a day to see another. You can link it to any of them —
                one the robot would skip is marked, and so is a shift the report doesn&rsquo;t fit (it
                starts more than {SHIFT_GRACE_MIN} minutes before the shift or ends more than{" "}
                {SHIFT_GRACE_MIN} minutes after). You&rsquo;re asked to confirm first, and the robot
                leaves a report you link by hand where you put it. Or create the job if nobody logged
                it.
              </p>
            </div>
            <IgnoreButton reportId={report.id} ignored={report.status === "IGNORED"} />
          </div>

          <form method="get" className="flex flex-wrap items-end gap-2">
            {showClosed && <input type="hidden" name="closed" value="1" />}
            <label htmlFor="ff-site" className="block w-full sm:w-auto min-w-0 max-w-full">
              <span className="label">Site</span>
              <select
                id="ff-site"
                name="site"
                defaultValue={chosen?.id ?? ""}
                className="input w-full sm:w-auto max-w-full sm:max-w-md"
              >
                <option value="">— pick a site —</option>
                {groups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.postcodeFormatted ? ` (${s.postcodeFormatted})` : ""}
                        {s.active ? "" : " — closed"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label htmlFor="ff-day" className="block">
              <span className="label">
                Another day <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <input
                id="ff-day"
                type="date"
                name="day"
                defaultValue={listWindow.day ?? ""}
                className="input w-auto"
              />
            </label>
            <button type="submit" className="btn btn-secondary">
              Show activities
            </button>
          </form>
          {(closedCount > 0 || listWindow.day) && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {closedCount > 0 && (
                <Link
                  href={hrefWith({ closed: !showClosed })}
                  className="inline-flex items-center min-h-[44px] md:min-h-0 text-brand-blue-dark hover:underline"
                >
                  {showClosed ? "Hide closed sites" : `Show closed sites (${closedCount})`}
                </Link>
              )}
              {listWindow.day && (
                <Link
                  href={hrefWith({ day: null })}
                  className="inline-flex items-center min-h-[44px] md:min-h-0 text-brand-blue-dark hover:underline"
                >
                  Back to the days around the report
                </Link>
              )}
            </p>
          )}

          {chosen && (
            <>
              <p className="text-xs text-slate-500">
                {dayText
                  ? `At ${chosen.name} on ${dayText}.`
                  : `At ${chosen.name} from ${formatDate(listWindow.from)} to ${formatDate(listWindow.to)}, around the report (${spanText(span)}).`}{" "}
                Client: {chosenOwner?.name ?? "none"}
                {chosen.active ? "" : " · this site is closed"}.
              </p>
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {dayText
                    ? `Nothing at this site on ${dayText}.`
                    : `Nothing at this site from ${HAND_LINK_REACH_DAYS} days before the report to ${HAND_LINK_REACH_DAYS} days after.`}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {rows.map(({ a, words, when, beside, markers, outcome, warning }) => (
                    <li
                      key={`${a.kind}:${a.id}`}
                      className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                    >
                      <span className="font-medium text-slate-900">{words.label}</span>
                      <span className="text-slate-500 tabular-nums">{when}</span>
                      <span
                        className={
                          "text-xs " +
                          (a.kind === "shift" && !a.outside ? "text-emerald-700" : a.outside ? "text-amber-800" : "text-slate-500")
                        }
                      >
                        {beside}
                      </span>
                      {markers.map((m) => (
                        <span key={m} className="text-xs font-medium text-amber-800">
                          {m}
                        </span>
                      ))}
                      <Link
                        href={activityHref(a.kind, a.id)}
                        aria-label={`View the ${words.noun} ${when}`}
                        className="inline-flex items-center min-h-[44px] md:min-h-0 px-1 text-xs text-brand-blue-dark hover:underline"
                      >
                        view
                      </Link>
                      <span className="ml-auto">
                        <LinkButton
                          reportId={report.id}
                          kind={a.kind}
                          activityId={a.id}
                          ariaLabel={`Link to the ${words.noun} ${when}`}
                          done={outcome.toast}
                          confirm={{
                            title: `Link this report to the ${words.noun}?`,
                            details: [
                              { term: "What", value: words.label },
                              { term: "When", value: a.kind === "shift" ? when : `${when} (${beside})` },
                              { term: "Site", value: `${chosen.name}${chosen.active ? "" : " (closed)"}` },
                              { term: "Client", value: chosenOwner?.name ?? "None" },
                              {
                                term: "Report",
                                value: a.kind === "shift" ? `${spanText(span)} — ${beside}` : spanText(span),
                              },
                            ],
                            notes: markers,
                            effect: outcome.effect,
                            warning,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {list.more && (
                <p className="text-xs text-slate-500">
                  There&rsquo;s more at this site than this list holds. Pick a day to see all of that
                  day.
                </p>
              )}
              {chosen.active ? (
                <CreateJobForm
                  reportId={report.id}
                  siteId={chosen.id}
                  defaultType={facts.visitType ?? report.form.jobType}
                  siteName={chosen.name}
                  clientName={chosenOwner?.name ?? null}
                  warning={otherClientWarning({
                    what: "site",
                    owner: chosenOwner,
                    formClient,
                    matchedSite: matched,
                  })}
                />
              ) : (
                <p className="pt-2 border-t border-slate-100 text-sm text-slate-500">
                  This site is closed, so a job can&rsquo;t be created there. You can still link the
                  report to anything listed.
                </p>
              )}
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
