import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/dates";
import {
  activityHref,
  describeActivity,
  getDailyCheckSettings,
  type DailyCheckCounts,
  type DailyCheckFindings,
} from "@/lib/dailyCheck";
import { SettingsForm } from "./_components/SettingsForm";

export const dynamic = "force-dynamic";

const SEVERITY_CHIP: Record<string, string> = {
  high: "chip-red",
  medium: "chip-amber",
  low: "chip-slate",
};

export default async function DailyCheckPage({
  searchParams,
}: {
  searchParams: { id?: string };
}) {
  await requireAdmin();
  const wanted = searchParams.id && /^[0-9a-f-]{36}$/i.test(searchParams.id) ? searchParams.id : null;

  const [settings, history] = await Promise.all([
    getDailyCheckSettings(),
    prisma.dailyCheck.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, createdAt: true, trigger: true, counts: true, emailedAt: true },
    }),
  ]);
  const shownId = wanted ?? history[0]?.id ?? null;
  const check = shownId
    ? await prisma.dailyCheck.findUnique({ where: { id: shownId } })
    : null;
  const f = check?.findings as unknown as DailyCheckFindings | undefined;
  const c = check?.counts as unknown as DailyCheckCounts | undefined;
  const fallback = process.env.ADMIN_EMAIL?.trim() || null;

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="Daily check"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Every morning the app looks over everything since the last check: the same visit recorded twice, our own jobs, patrols and shifts with no report, FastField reports whose GPS, site name, form or officer don't fit, and incidents Claude finds in the reports. The result is emailed to the office."
      />

      <div className="card p-5">
        <SettingsForm
          enabled={settings.enabled}
          recipients={settings.recipients ?? ""}
          fallback={fallback}
        />
      </div>

      {!check || !f || !c ? (
        <div className="card p-6 text-center text-sm text-slate-500">
          No checks yet — the first runs tomorrow morning, or press &ldquo;Run the check now&rdquo;.
        </div>
      ) : (
        <>
          <div className="card p-5 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-brand-navy">
                {c.total ? `${c.total} to look at` : "All clear"}
              </h2>
              <span className="text-xs text-slate-500">
                {formatDateTime(f.period.from)} to {formatDateTime(f.period.until)} ·{" "}
                {f.reportsRead} FastField reports read ·{" "}
                {check.trigger === "cron" ? "morning run" : "run by hand"}
                {check.emailedAt
                  ? ` · emailed ${formatDateTime(check.emailedAt)} to ${check.emailedTo}`
                  : ""}
              </span>
            </div>
            {check.overview && <p className="text-sm text-slate-800">{check.overview}</p>}
            {f.claudeNote && <p className="text-xs text-slate-500">{f.claudeNote}</p>}
          </div>

          <Section title="Incidents and security issues" count={f.incidents.length} empty="None reported.">
            {f.incidents.map((i, n) => (
              <li key={`${i.reportId}-${n}`} className="px-4 py-2.5 text-sm space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className={SEVERITY_CHIP[i.severity] ?? "chip-slate"}>{i.severity}</span>
                  <span className="font-medium text-slate-900">{i.category}</span>
                  <span className="text-xs text-slate-500">
                    {i.siteName ?? "Unknown site"} · {formatDateTime(i.at)}
                  </span>
                  <Link href={`/admin/fastfield/${i.reportId}`} className="ml-auto text-xs text-brand-blue-dark hover:underline">
                    Report →
                  </Link>
                </div>
                <p className="text-slate-700">{i.summary}</p>
              </li>
            ))}
          </Section>

          <Section
            title="Possible duplicates"
            count={f.duplicates.length}
            empty="Nothing recorded twice."
            help="The same visit at the same site and time, from two places — e.g. a callout logged by the office and again from a FastField report. Nexus copies of patrols on our schedule are merged into the patrol automatically; one still listed here has been worked on (an officer, billing or a report), so keep one and cancel the other. A pair marked “one place on two site records” means the site itself is in the system twice — ask for the two records to be merged."
          >
            {f.duplicates.map((d, n) => (
              <li key={n} className="px-4 py-2.5 text-sm space-y-1">
                <div className="font-medium text-slate-900">{d.siteName}</div>
                <ul className="space-y-0.5">
                  {d.items.map((a) => (
                    <li key={a.id}>
                      <Link href={activityHref(a)} className="text-brand-blue-dark hover:underline">
                        {describeActivity(a)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </Section>

          <Section
            title="Missing reports"
            count={f.missing.length}
            empty={f.missingSkipped ?? "Every job, patrol and shift has its report."}
            help="Our own officers' work with no report attached. Work reported in Nexus's or Keyholding's own apps is left out."
          >
            {f.missing.map((m) => (
              <li key={m.item.id} className="px-4 py-2.5 text-sm flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-slate-900">{m.siteName}</span>
                <Link href={activityHref(m.item)} className="text-brand-blue-dark hover:underline">
                  {describeActivity(m.item)}
                </Link>
                <span className="text-slate-600">— {m.why}</span>
              </li>
            ))}
          </Section>

          <Section
            title="FastField report problems"
            count={f.reportIssues.length}
            empty="Every report fits its site and job."
          >
            {f.reportIssues.map((r) => (
              <li key={r.reportId} className="px-4 py-2.5 text-sm space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/admin/fastfield/${r.reportId}`} className="font-medium text-brand-blue-dark hover:underline">
                    {r.siteName ?? "Unknown site"}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {r.form} · {formatDateTime(r.at)}
                    {r.officer ? ` · ${r.officer}` : ""}
                  </span>
                </div>
                <ul className="list-disc pl-5 text-slate-700">
                  {r.issues.map((x, n) => (
                    <li key={n}>{x}</li>
                  ))}
                </ul>
              </li>
            ))}
          </Section>

          <div className="card p-4 text-sm space-y-2">
            <h2 className="font-semibold text-brand-navy">Syncs</h2>
            <ul className="space-y-1">
              {f.syncs.map((s) => (
                <li key={s.name} className="flex flex-wrap items-center gap-x-2">
                  <span className={!s.lastSeen ? "chip-slate" : s.stale ? "chip-red" : "chip-mint"}>
                    {!s.lastSeen ? "no data" : s.stale ? "late" : "ok"}
                  </span>
                  <span className="text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-500">
                    last {s.lastSeen ? formatDateTime(s.lastSeen) : "— not run yet"}
                  </span>
                </li>
              ))}
            </ul>
            {f.unmatchedReports > 0 && (
              <p className="text-slate-700">
                {f.unmatchedReports} FastField report{f.unmatchedReports === 1 ? " is" : "s are"} waiting
                to be linked by hand —{" "}
                <Link href="/admin/fastfield" className="text-brand-blue-dark hover:underline">
                  open FastField
                </Link>
                .
              </p>
            )}
          </div>
        </>
      )}

      {history.length > 1 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Earlier checks</h2>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((h) => {
              const hc = h.counts as unknown as DailyCheckCounts;
              return (
                <li key={h.id}>
                  <Link
                    href={`/admin/daily-check?id=${h.id}`}
                    aria-current={h.id === shownId ? "page" : undefined}
                    className={`block px-4 py-2 hover:bg-slate-50 focus-visible:bg-slate-50 ${h.id === shownId ? "bg-slate-50" : ""}`}
                  >
                    <span className="text-slate-800">{formatDateTime(h.createdAt)}</span>
                    <span className="text-xs text-slate-500">
                      {" "}
                      · {hc.total ? `${hc.total} to look at` : "all clear"} ·{" "}
                      {h.trigger === "cron" ? "morning run" : "run by hand"}
                      {h.emailedAt ? " · emailed" : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  help,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold text-brand-navy">
          {title} ({count})
        </h2>
        {help && <p className="text-xs text-slate-500">{help}</p>}
      </div>
      {count === 0 ? (
        <div className="px-4 py-4 text-sm text-slate-500">{empty}</div>
      ) : (
        <ul className="divide-y divide-slate-100">{children}</ul>
      )}
    </div>
  );
}
