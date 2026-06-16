import { prisma } from "@/lib/db";
import { SiteForm } from "../_components/SiteForm";
import { createSite } from "../_actions";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewSitePage() {
  const [regions, customers, partners, officers] = await Promise.all([
    prisma.region.findMany({ orderBy: { name: "asc" } }),
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New site"
        backHref="/sites"
        backLabel="Back to sites"
        subtitle="Tick the services you cover and you'll get extra sections to fill in (keys, lock-up times, patrol schedule, alarm code, etc.)."
      />

      <SiteForm
        action={createSite}
        initial={{
          code: null,
          name: "",
          addressLine: "",
          postcode: "",
          city: null,
          type: "COMMERCIAL",
          regionId: null,
          customerId: null,
          partnerId: null,
          services: [],
          riskLevel: "LOW",
          notes: null,
          active: true,
          partnerReference: null,
          partnerSin: null,
          sapRef: null,
          opsUnit: null,
          what3words: null,
          partnerStatus: null,
          startDate: null,
          terminationDate: null,
          dne: false,
          hsMarkers: false,
          keySets: [],
          lockUnlock: {
            days: [],
            unlockTime: null,
            lockdownTime: null,
            assignedOfficerId: null,
          },
          patrolDays: [],
          vpiDays: [],
          access: {
            alarmCode: null,
            padlockCode: null,
            entryStepsMd: null,
            lockboxId: null,
            hazards: null,
          },
        }}
        regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        customers={customers}
        partners={partners}
        officers={officers}
        submitLabel="Create site"
      />
    </div>
  );
}
