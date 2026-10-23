import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatTimeAgo } from "@/lib/dates";
import { splitSiaNumber } from "@/lib/fastfield";
import { FormSettingsRow } from "./_components/FormSettingsRow";
import { RetryButton } from "./_components/RetryButton";
import { ReportStatusChip, activityLabel, describePreview } from "./_components/labels";

export const dynamic = "force-dynamic";

export default async function FastFieldPage() {
  await requireAdmin();

  const [forms, customers, byStatus, unmatched, recent] = await Promise.all([
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
        form: { select: { name: true } },
        site: { select: { name: true } },
      },
    }),
    prisma.fastFieldReport.findMany({
      where: { status: { in: ["LINKED", "CREATED"] } },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: {
        id: true,
        status: true,
        submittedAt: true,
        form: { select: { name: true } },
        site: { select: { name: true } },
        job: { select: { id: true, type: true } },
        patrolVisit: { select: { id: true } },
        shift: { select: { id: true } },
      },
    }),
  ]);

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
        subtitle="Reports our officers fill in on FastField, attached to what they're about. The robot collects them every 4 hours. Each report finds its site (postcode, then name, then GPS); a patrol round goes to the static shift on at the time, anything else to the nearest callout, patrol or lock-up there within 3 hours (or, failing that, the nearest of the same kind within 18 hours) — billed and paid like an officer's own report. With nothing to attach it to, a report filed during a static shift goes to the shift."
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

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">
              Needs linking ({totalUnmatched})
            </h2>
            <p className="text-xs text-slate-500">
              Reports that didn&rsquo;t match an activity on their own. Open one to link it, create
              the job, or set it aside.
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
              return (
                <li key={r.id} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ReportStatusChip status={r.status} />
                  <span className="text-slate-900">
                    {activityLabel(r.job ? r.job.type : r.shift ? "SHIFT" : "PATROL")} at{" "}
                    {r.site?.name ?? "—"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDateTime(r.submittedAt)} · {r.form.name.trim()}
                  </span>
                  <span className="ml-auto flex gap-3 text-xs">
                    <Link href={`/admin/fastfield/${r.id}`} className="text-brand-blue-dark hover:underline">
                      Report
                    </Link>
                    {href && (
                      <Link href={href} className="text-brand-blue-dark hover:underline">
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
    </div>
  );
}
