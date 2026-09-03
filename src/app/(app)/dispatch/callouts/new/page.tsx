import { prisma } from "@/lib/db";
import { recordDispatcherCallout } from "../_actions";
import { CalloutForm } from "../_components/CalloutForm";
import { listJobSourceOptions, listJobTypeOptions } from "@/lib/labels";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const CALLOUT_TYPE_CODES = new Set([
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "ADHOC",
  "STATIC_GUARDING_SHIFT",
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
  const [sites, officers, partners, customerOnlyPartnerCount, allJobTypes, allJobSources] = await Promise.all([
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
    prisma.partner.findMany({
      where: { active: true, role: { in: ["SUBCONTRACTOR", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Also count any active partners we're NOT showing so we can tell the
    // operator "you have partners but they're configured as customers,
    // change their role" vs "create a partner from scratch."
    prisma.partner.count({
      where: { active: true, role: { notIn: ["SUBCONTRACTOR", "BOTH"] } },
    }),
    listJobTypeOptions(),
    listJobSourceOptions(),
  ]);

  // Callout flow only covers a subset of job types/sources — scheduled work
  // is captured via the cron, shift jobs via the shift flow, etc. Dedupe by
  // label so a duplicate option row never shows the same type twice.
  const seenTypeLabel = new Set<string>();
  const jobTypes = allJobTypes
    .filter((o) => CALLOUT_TYPE_CODES.has(o.code))
    .filter((o) => {
      const key = o.label.trim().toLowerCase();
      if (seenTypeLabel.has(key)) return false;
      seenTypeLabel.add(key);
      return true;
    });
  const jobSources = allJobSources.filter((o) =>
    CALLOUT_SOURCE_CODES.has(o.code),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Record callout"
        backHref="/dispatch"
        backLabel="Dispatch"
        subtitle="Log a callout that's already been handled — for record keeping, officer pay, and (by default) inclusion in the daily client report. Skips the officer-fills-form / admin-review pipeline."
      />

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
    </div>
  );
}
