import Link from "next/link";
import { requireAdminPage } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatTimeAgo } from "@/lib/dates";
import { SHIFT_GRACE_MIN, shiftHoursText, spanText, splitSiaNumber } from "@/lib/fastfield";
import { OUTSIDE_CHECK_DAYS, reportsOutsideTheirShift, waitingPlaces } from "@/lib/fastfieldImport";
import { takenOffText } from "@/lib/fastfieldAdminList";
import { FormSettingsRow } from "./_components/FormSettingsRow";
import { RetryButton } from "./_components/RetryButton";
import { UnlinkButton } from "./_components/ReportActions";
import { SkipPlaceButton, StopSkippingButton } from "./_components/SkipPlace";
import { ReportStatusChip, activityLabel, describePreview } from "./_components/labels";

export const dynamic = "force-dynamic";
// "Try matching again" matches for up to 35 seconds of this.
export const maxDuration = 60;

/** Places shown in "Waiting, by place" (the biggest first). */
const PLACES_SHOWN = 12;
/** Reports shown under "On a shift, outside its time" (the newest first). */
const OUTSIDE_SHOWN = 25;
/** "Set aside": reports set aside by hand this many days back, at most SET_ASIDE_SHOWN. */
const SET_ASIDE_DAYS = 60;
const SET_ASIDE_SHOWN = 25;

/** A small text link with a big enough target to tap (44px on phones). */
const SMALL_LINK =
  "inline-flex min-h-[2.75rem] items-center text-brand-blue-dark hover:underline md:min-h-[1.5rem]";

export default async function FastFieldPage() {
  await requireAdminPage();

  const setAsideSince = new Date(Date.now() - SET_ASIDE_DAYS * 86_400_000);
  // Set aside by a person; a skipped place's reports are under Skipped places.
  const setAsideWhere = { status: "IGNORED" as const, skipId: null, updatedAt: { gte: setAsideSince } };
  const [forms, customers, byStatus, unmatched, recent, places, skips, outside, offShifts, setAside, setAsideCount] = await Promise.all([
    prisma.fastFieldForm.findMany({
      orderBy: [{ mode: "desc" }, { name: "asc" }],
      select: {
        formId: true,
        name: true,
        mode: true,
        jobType: true,
        customerId: true,
        createCustomerId: true,
        previewCounts: true,
        previewAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.fastFieldReport.groupBy({
      by: ["formId", "status"],
      _count: { _all: true },
    }),
    prisma.fastFieldReport.findMany({
      where: { status: "UNMATCHED" },
      orderBy: { submittedAt: "desc" },
      take: 50,
      select: {
        id: true,
        submittedAt: true,
        siteText: true,
        officerText: true,
        note: true,
        photoUrls: true,
        checkedAt: true,
        createdAt: true,
        form: { select: { name: true } },
        site: { select: { name: true } },
      },
    }),
    // By when each was attached (`linkedAt`): the robot's re-checks touch
    // `updatedAt`, so that would list re-checked rounds, not new ones.
    prisma.fastFieldReport.findMany({
      where: { status: { in: ["LINKED", "CREATED"] } },
      orderBy: [{ linkedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 15,
      select: {
        id: true,
        status: true,
        submittedAt: true,
        linkedAt: true,
        linkedByHand: true,
        form: { select: { name: true } },
        site: { select: { name: true } },
        job: { select: { id: true, type: true } },
        patrolVisit: { select: { id: true } },
        shift: { select: { id: true } },
      },
    }),
    // Counted in the database, not one row per waiting report.
    waitingPlaces(),
    prisma.fastFieldSkip.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        createdBy: true,
        createdAt: true,
        _count: { select: { reports: { where: { status: "IGNORED" } } } },
      },
    }),
    reportsOutsideTheirShift(),
    // Waiting reports taken off a shift, by who took them off.
    prisma.fastFieldReport.groupBy({
      by: ["unlinkedBy"],
      where: { status: "UNMATCHED", unlinkedAt: { not: null } },
      _count: { _all: true },
    }),
    // Set aside in the last 60 days, the most recent first (nothing else
    // changes a set-aside report, so `updatedAt` is when it was set aside).
    prisma.fastFieldReport.findMany({
      where: setAsideWhere,
      orderBy: { updatedAt: "desc" },
      take: SET_ASIDE_SHOWN,
      select: {
        id: true,
        submittedAt: true,
        updatedAt: true,
        siteText: true,
        officerText: true,
        note: true,
        form: { select: { name: true } },
        site: { select: { name: true } },
      },
    }),
    prisma.fastFieldReport.count({ where: setAsideWhere }),
  ]);
  const takenOffByRobot = offShifts.find((g) => g.unlinkedBy === "ROBOT")?._count._all ?? 0;
  const takenOffByPerson = offShifts.reduce((n, g) => n + g._count._all, 0) - takenOffByRobot;
  const takenOff = takenOffText(takenOffByPerson, takenOffByRobot);

  const counts = new Map<number, { attached: number; unmatched: number }>();
  let totalUnmatched = 0;
  let totalAttached = 0;
  for (const g of byStatus) {
    const c = counts.get(g.formId) ?? { attached: 0, unmatched: 0 };
    if (g.status === "LINKED" || g.status === "CREATED") {
      c.attached += g._count._all;
      totalAttached += g._count._all;
    }
    if (g.status === "UNMATCHED") {
      c.unmatched += g._count._all;
      totalUnmatched += g._count._all;
    }
    counts.set(g.formId, c);
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="FastField"
        backHref="/admin"
        backLabel="Admin"
        subtitle={`Reports our officers fill in on FastField, attached to what they're about. The robot collects them every 4 hours. Each report finds its site (postcode, then name, then GPS); a patrol round goes to a static shift it fits, anything else to the nearest callout, patrol or lock-up there within 3 hours (or, failing that, the nearest of the same kind within 18 hours) — billed and paid like an officer's own report. With nothing else to attach it to, a report goes to a static shift it fits. The robot never gives a callout, patrol or lock-up a second report: when the nearest one already has one, the new report waits for you (a shift takes any number of rounds). It only puts a report on a shift it fits, give or take ${SHIFT_GRACE_MIN} minutes, going by the times typed in the report (or when it was sent, if none were typed): it can't start more than ${SHIFT_GRACE_MIN} minutes before the shift starts or finish more than ${SHIFT_GRACE_MIN} minutes after it ends. Every 5 minutes the robot checks the reports it put on shifts, and moves any that no longer fit to a shift there that they do fit, or takes them off. You can link any report to any shift, job or visit yourself; the robot leaves those where you put them.`}
      />

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Forms</h2>
          <p className="text-xs text-slate-500">
            <span className="font-medium">Preview only</span> shows what a form&rsquo;s reports would
            do when you run a preview, without importing anything; <span className="font-medium">On</span>{" "}
            imports them. A form used for several clients covers <span className="font-medium">any
            client</span> — the site in each report decides. A job is only made when a report matches
            nothing at the client named under &ldquo;Make the job&rdquo; (Shurgard); other reports wait
            below to be linked by hand.
          </p>
        </div>
        {forms.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            No forms yet — they appear after the robot&rsquo;s first run (every 4 hours, or run
            &ldquo;FastField forms&rdquo; in GitHub Actions).
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {forms.map((f) => (
              <li key={f.formId}>
                <FormSettingsRow
                  form={{
                    formId: f.formId,
                    name: f.name,
                    mode: f.mode,
                    jobType: f.jobType,
                    customerId: f.customerId,
                    createCustomerId: f.createCustomerId,
                  }}
                  preview={
                    f.previewAt
                      ? `Last preview ${formatDateTime(f.previewAt)}: ${describePreview(f.previewCounts)}`
                      : null
                  }
                  lastSeen={formatTimeAgo(f.lastSeenAt)}
                  attached={counts.get(f.formId)?.attached ?? 0}
                  unmatched={counts.get(f.formId)?.unmatched ?? 0}
                  customers={customers}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {places.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Waiting, by place</h2>
            <p className="text-xs text-slate-500">
              Reports waiting to be linked, grouped by the site the officer typed. <span className="font-medium">Skip</span>{" "}
              sets aside all of a place&rsquo;s waiting reports, and new ones typed the same way as they
              arrive, for a place you don&rsquo;t need them for. Reports that match an activity still link
              as usual. Nothing is deleted: stop skipping under &ldquo;Skipped places&rdquo; to bring them back.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {places.slice(0, PLACES_SHOWN).map((g) => (
              <li key={g.key} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 break-words">&ldquo;{g.label}&rdquo;</div>
                  <div className="text-xs text-slate-500">
                    {g.count} waiting · latest {formatDateTime(g.latest)}
                    {g.siteName ? ` · matched to ${g.siteName}` : " · site not recognised"}
                  </div>
                </div>
                <SkipPlaceButton placeKey={g.key} label={g.label} count={g.count} />
              </li>
            ))}
          </ul>
          {places.length > PLACES_SHOWN && (
            <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
              {places.length - PLACES_SHOWN} more place{places.length - PLACES_SHOWN === 1 ? "" : "s"} with fewer
              reports.
            </div>
          )}
        </div>
      )}

      {skips.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Skipped places</h2>
            <p className="text-xs text-slate-500">
              New reports typed like these are set aside as they arrive, unless they match an activity.
              Stop skipping brings a place&rsquo;s reports back to Needs linking: the robot tries them
              again, except any taken off a shift — one a person took off waits for you, and one the
              robot took off only goes back on a shift it fits.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {skips.map((k) => (
              <li key={k.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 break-words">&ldquo;{k.label}&rdquo;</div>
                  <div className="text-xs text-slate-500">
                    {k._count.reports} set aside · skipped {formatDateTime(k.createdAt)}
                    {k.createdBy ? ` by ${k.createdBy}` : ""}
                  </div>
                </div>
                <StopSkippingButton skipId={k.id} label={k.label} count={k._count.reports} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {outside.length > 0 && (
        <div className="card overflow-hidden border-amber-300">
          <div className="px-4 py-3 border-b border-slate-100 bg-amber-50">
            <h2 className="font-semibold text-brand-navy">
              On a shift, outside its time ({outside.length})
            </h2>
            <p className="text-xs text-slate-600">
              Reports from the last {OUTSIDE_CHECK_DAYS} days that the robot put on a static shift but
              that start more than {SHIFT_GRACE_MIN} minutes before it starts or finish more than{" "}
              {SHIFT_GRACE_MIN} minutes after it ends (going by the times typed in them, or when they
              were sent). Every 5
              minutes the robot checks the reports it put on shifts and sorts these out by itself: it
              moves each to a shift at the site it does fit, or takes it off to wait in Needs linking.
              One already sent to the client stays where it is, for you to decide. Reports linked by
              hand aren&rsquo;t listed: a person put them there on purpose. To deal with one now,
              unlink it.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {outside.slice(0, OUTSIDE_SHOWN).map((r) => {
              const what = `${r.siteName}, ${spanText(r.span)}`;
              return (
                <li key={r.reportId} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 break-words">{r.siteName}</div>
                    <div className="text-xs text-slate-500">
                      Report {spanText(r.span)} · shift {shiftHoursText(r.shift)}
                    </div>
                    <div className="text-xs text-amber-800">The report {r.outside}.</div>
                  </div>
                  {/* Named so each row's Unlink says which report it is. */}
                  <span role="group" aria-label={`Report at ${what}`} className="flex items-center gap-3 text-xs">
                    <Link href={`/admin/fastfield/${r.reportId}`} className={SMALL_LINK} aria-label={`Report at ${what}`}>
                      Report
                    </Link>
                    <Link
                      href={`/shifts/${r.shiftId}`}
                      className={SMALL_LINK}
                      aria-label={`Shift at ${r.siteName}, ${shiftHoursText(r.shift)}`}
                    >
                      Shift →
                    </Link>
                    <UnlinkButton reportId={r.reportId} className="btn btn-secondary text-xs" />
                  </span>
                </li>
              );
            })}
          </ul>
          {outside.length > OUTSIDE_SHOWN && (
            <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
              Showing the newest {OUTSIDE_SHOWN} of {outside.length}.
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">
              Needs linking ({totalUnmatched})
            </h2>
            <p className="text-xs text-slate-500">
              Reports that didn&rsquo;t match an activity on their own. Every 5 minutes the robot tries
              those from the last 30 days again (forms set to On), starting with those whose site has
              had a shift or job recorded since; <span className="font-medium">Try matching again</span>{" "}
              does it now, for the last 60 days. A report a person took off a shift waits for you; one
              the robot took off only goes back on a shift it fits, otherwise it waits for you too.
              {takenOff && ` ${takenOff}`}{" "}
              Open one to link it, create the job, or set it aside, or skip a whole place under
              &ldquo;Waiting, by place&rdquo; above.
            </p>
          </div>
          {totalUnmatched > 0 && <RetryButton />}
        </div>
        {unmatched.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Nothing to link.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {unmatched.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/fastfield/${r.id}`}
                  className="block px-4 py-3 hover:bg-slate-50 focus-visible:bg-slate-50"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-slate-900">
                      {r.site?.name ?? r.siteText ?? "Site not given"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDateTime(r.submittedAt)} · {r.form.name.trim()}
                      {r.officerText ? ` · ${splitSiaNumber(r.officerText).name ?? r.officerText}` : ""}
                      {r.photoUrls.length
                        ? ` · ${r.photoUrls.length} photo${r.photoUrls.length === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </div>
                  {r.note && <div className="text-xs text-amber-800 mt-0.5">{r.note}</div>}
                  <div className="text-xs text-slate-500 mt-0.5">
                    Last tried {formatTimeAgo(r.checkedAt ?? r.createdAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {totalUnmatched > unmatched.length && (
          <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
            Showing the latest {unmatched.length} of {totalUnmatched}.
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            Recently attached ({totalAttached} in all)
          </h2>
          <p className="text-xs text-slate-500">The latest to be linked or to have a job made, newest first.</p>
        </div>
        {recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">None yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => {
              const href = r.job
                ? `/dispatch/${r.job.id}`
                : r.patrolVisit
                  ? `/patrols/visits/${r.patrolVisit.id}`
                  : r.shift
                    ? `/shifts/${r.shift.id}`
                    : null;
              const kind = r.job
                ? activityLabel(r.job.type)
                : r.shift
                  ? activityLabel("SHIFT")
                  : r.patrolVisit
                    ? activityLabel("PATROL")
                    : null;
              const where = r.site?.name ?? "—";
              return (
                <li key={r.id} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ReportStatusChip status={r.status} />
                  <span className="text-slate-900">
                    {kind ? `${kind} at ${where}` : `${where} — its activity was deleted`}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDateTime(r.submittedAt)} · {r.form.name.trim()}
                    {r.linkedAt ? ` · attached ${formatTimeAgo(r.linkedAt)}` : ""}
                    {r.linkedByHand ? " by hand" : ""}
                  </span>
                  <span className="ml-auto flex gap-3 text-xs">
                    <Link
                      href={`/admin/fastfield/${r.id}`}
                      className={SMALL_LINK}
                      aria-label={`Report: ${kind ?? "deleted activity"} at ${where}, ${formatDateTime(r.submittedAt)}`}
                    >
                      Report
                    </Link>
                    {href && kind && (
                      <Link href={href} className={SMALL_LINK} aria-label={`Activity: ${kind} at ${where}`}>
                        Activity →
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {setAsideCount > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Set aside ({setAsideCount})</h2>
            <p className="text-xs text-slate-500">
              Reports someone set aside in the last {SET_ASIDE_DAYS} days (a test, a duplicate), the
              most recent first. Open one to bring it back to Needs linking. Reports set aside by
              skipping a place are under &ldquo;Skipped places&rdquo;.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {setAside.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/fastfield/${r.id}`}
                  className="block px-4 py-3 hover:bg-slate-50 focus-visible:bg-slate-50"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-slate-900">
                      {r.site?.name ?? r.siteText ?? "Site not given"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDateTime(r.submittedAt)} · {r.form.name.trim()}
                      {r.officerText ? ` · ${splitSiaNumber(r.officerText).name ?? r.officerText}` : ""}
                    </span>
                  </div>
                  {r.note && <div className="text-xs text-slate-600 mt-0.5">{r.note}</div>}
                  <div className="text-xs text-slate-500 mt-0.5">Set aside {formatTimeAgo(r.updatedAt)}</div>
                </Link>
              </li>
            ))}
          </ul>
          {setAsideCount > setAside.length && (
            <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
              Showing the latest {setAside.length} of {setAsideCount}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
