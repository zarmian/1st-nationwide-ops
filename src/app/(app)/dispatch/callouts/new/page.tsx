import Link from "next/link";
import { prisma } from "@/lib/db";
import { recordDispatcherCallout } from "../_actions";
import { CalloutForm } from "../_components/CalloutForm";
import { listJobSourceOptions, listJobTypeOptions } from "@/lib/labels";

export const dynamic = "force-dynamic";

const CALLOUT_TYPE_CODES = new Set([
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "ADHOC",
]);

const CALLOUT_SOURCE_CODES = new Set([
  "ALARM",
  "CUSTOMER_REQUEST",
  "PARTNER_REQUEST",
  "AD_HOC",
]);

export default async function NewCalloutPage({
  searchParams,
}: {
  searchParams: { siteId?: string };
}) {
  const [sites, officers, allJobTypes, allJobSources] = await Promise.all([
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        postcodeFormatted: true,
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: "OFFICER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listJobTypeOptions(),
    listJobSourceOptions(),
  ]);

  // Callout flow only covers a subset of job types/sources — scheduled work
  // is captured via the cron, shift jobs via the shift flow, etc.
  const jobTypes = allJobTypes.filter((o) => CALLOUT_TYPE_CODES.has(o.code));
  const jobSources = allJobSources.filter((o) =>
    CALLOUT_SOURCE_CODES.has(o.code),
  );

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/dispatch"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Dispatch
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Record callout
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Log a callout that's already been handled — for record keeping,
          officer pay, and (by default) inclusion in the daily client
          report. Skips the officer-fills-form / admin-review pipeline.
        </p>
      </div>

      <CalloutForm
        action={recordDispatcherCallout}
        sites={sites}
        officers={officers}
        jobTypes={jobTypes}
        jobSources={jobSources}
        defaultSiteId={searchParams.siteId}
      />
    </div>
  );
}
