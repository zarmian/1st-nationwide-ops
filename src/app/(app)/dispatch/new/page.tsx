import Link from "next/link";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { createJob } from "../_actions";
import { recordDispatcherCallout } from "../callouts/_actions";
import { createShift, recordCompletedShift } from "../../shifts/_actions";
import { PageHeader } from "@/components/PageHeader";
import { NewJobForm } from "../_components/NewJobForm";
import { CalloutForm } from "../callouts/_components/CalloutForm";
import { NewShiftForm } from "../../shifts/_components/NewShiftForm";
import { CompletedShiftForm } from "../../shifts/_components/CompletedShiftForm";
import { listJobSourceOptions, listJobTypeOptions } from "@/lib/labels";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "callout", label: "Callout" },
  { key: "static", label: "Static guarding" },
  { key: "dog", label: "Dog handling" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const MODES = [
  { key: "schedule", label: "Schedule for later" },
  { key: "record", label: "Record (already done)" },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

// Callout tab, "record" mode — the reactive callout set. Shift types have
// their own tabs, so they're not offered here.
const CALLOUT_RECORD_TYPE_CODES = new Set([
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "ADHOC",
]);
// Callout tab, "schedule" mode — everything except the shift types.
const SCHEDULE_EXCLUDED_TYPES = new Set([
  "STATIC_GUARDING_SHIFT",
  "DOG_HANDLER_SHIFT",
]);
const SCHEDULE_SOURCE_EXCLUDED = new Set(["ALARM", "AD_HOC"]);
const CALLOUT_SOURCE_CODES = new Set([
  "ALARM",
  "CUSTOMER_REQUEST",
  "PARTNER_REQUEST",
  "AD_HOC",
]);

function dedupeByLabel<T extends { label: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((o) => {
    const k = o.label.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * One place to log any activity from the dispatch board. Tabs pick the kind
 * (callout / static guarding / dog handling); a mode toggle picks whether
 * you're scheduling it for later or recording one that's already been done.
 * Each tab reuses the existing, validated form + server action.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: { tab?: string; mode?: string; siteId?: string };
}) {
  const tab: TabKey = (
    TABS.some((t) => t.key === searchParams.tab) ? searchParams.tab : "callout"
  ) as TabKey;
  const mode: ModeKey = (
    MODES.some((m) => m.key === searchParams.mode)
      ? searchParams.mode
      : "schedule"
  ) as ModeKey;

  const [
    sites,
    officers,
    partners,
    customerOnlyPartnerCount,
    allJobTypes,
    allJobSources,
  ] = await Promise.all([
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, postcodeFormatted: true },
    }),
    prisma.user.findMany({
      // Officers only — activities are never assigned to office staff.
      where: { active: true, role: "OFFICER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true, role: { in: ["SUBCONTRACTOR", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.count({
      where: { active: true, role: { notIn: ["SUBCONTRACTOR", "BOTH"] } },
    }),
    listJobTypeOptions(),
    listJobSourceOptions(),
  ]);

  const hrefFor = (t: TabKey, m: ModeKey) =>
    `/dispatch/new?tab=${t}&mode=${m}`;

  let form: ReactNode;
  if (tab === "callout") {
    if (mode === "schedule") {
      const jobTypes = dedupeByLabel(
        allJobTypes.filter((o) => !SCHEDULE_EXCLUDED_TYPES.has(o.code)),
      );
      const jobSources = allJobSources
        .filter((o) => !SCHEDULE_SOURCE_EXCLUDED.has(o.code))
        .map((o) => (o.code === "PARTNER_REQUEST" ? { ...o, label: "Nexus" } : o));
      form = (
        <NewJobForm
          action={createJob}
          sites={sites}
          officers={officers}
          partners={partners}
          jobTypes={jobTypes}
          jobSources={jobSources}
          defaultSiteId={searchParams.siteId}
        />
      );
    } else {
      const jobTypes = dedupeByLabel(
        allJobTypes.filter((o) => CALLOUT_RECORD_TYPE_CODES.has(o.code)),
      );
      const jobSources = allJobSources.filter((o) =>
        CALLOUT_SOURCE_CODES.has(o.code),
      );
      form = (
        <CalloutForm
          action={recordDispatcherCallout}
          sites={sites}
          officers={officers}
          partners={partners}
          customerOnlyPartnerCount={customerOnlyPartnerCount}
          jobTypes={jobTypes}
          jobSources={jobSources}
          defaultSiteId={searchParams.siteId}
        />
      );
    }
  } else {
    const lockedType = tab === "static" ? "STATIC_GUARDING" : "DOG_HANDLER";
    form =
      mode === "schedule" ? (
        <NewShiftForm
          action={createShift}
          sites={sites}
          officers={officers}
          partners={partners}
          lockedType={lockedType}
          cancelHref="/dispatch"
        />
      ) : (
        <CompletedShiftForm
          action={recordCompletedShift}
          sites={sites}
          officers={officers}
          partners={partners}
          lockedType={lockedType}
          cancelHref="/dispatch"
        />
      );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="New job"
        backHref="/dispatch"
        backLabel="Dispatch"
        subtitle="Log a callout, static guarding or dog-handler shift — schedule it for later, or record one that's already been done."
      />

      {/* Kind of activity */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(t.key, mode)}
            aria-current={t.key === tab ? "page" : undefined}
            className={t.key === tab ? "pill-active" : "pill-idle"}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Schedule vs record */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
        {MODES.map((m) => (
          <Link
            key={m.key}
            href={hrefFor(tab, m.key)}
            aria-current={m.key === mode ? "true" : undefined}
            className={
              "rounded-md px-3 py-1.5 transition-colors " +
              (m.key === mode
                ? "bg-brand-blue-100 font-medium text-brand-blue-800"
                : "text-slate-600 hover:bg-slate-50")
            }
          >
            {m.label}
          </Link>
        ))}
      </div>

      {form}
    </div>
  );
}
