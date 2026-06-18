import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { PartnerActivityForm } from "../_components/PartnerActivityForm";
import { createPartnerActivity } from "../_actions";

export const dynamic = "force-dynamic";

/**
 * Customer + site picker source.
 *
 * Partners pick from OUR active customer list, then OUR active sites
 * under that customer. Sites without a customer link aren't pickable —
 * Q4 = a, customer is required. Heavy list but bounded (a few hundred
 * sites total); no virtualisation needed for v1.
 */
export default async function NewPartnerActivityPage() {
  const me = await requirePartner();

  const [customers, sites, officers, rates] = await Promise.all([
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.site.findMany({
      where: { active: true, customerId: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, customerId: true },
    }),
    prisma.partnerOfficer.findMany({
      where: { partnerId: me.partnerId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partnerRate.findMany({
      where: { partnerId: me.partnerId },
      select: {
        service: true,
        chargeToUs: true,
        payToOfficer: true,
        unit: true,
      },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Record activity"
        backHref="/partner/activities"
        backLabel="Activities"
        subtitle="Log a job or shift you've done for 1NW. Pick the customer + site, then your officer and the rate."
      />
      <PartnerActivityForm
        action={createPartnerActivity}
        submitLabel="Save activity"
        initial={{
          kind: "JOB",
          type: "ALARM_RESPONSE",
          customerId: "",
          siteId: "",
          partnerOfficerId: null,
          chargeToUs: 0,
          payToOfficer: 0,
          notes: null,
          scheduledFor: null,
          completedAt: null,
        }}
        customers={customers}
        sites={sites.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          customerId: s.customerId ?? "",
        }))}
        officers={officers}
        rates={rates.map((r) => ({
          service: r.service,
          chargeToUs: Number(r.chargeToUs),
          payToOfficer: Number(r.payToOfficer),
          unit: r.unit,
        }))}
      />
    </div>
  );
}
