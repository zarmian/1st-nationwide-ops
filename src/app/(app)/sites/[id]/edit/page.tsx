import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SiteForm } from "../../_components/SiteForm";
import { updateSite } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const [site, regions, customers, partners] = await Promise.all([
    prisma.site.findUnique({ where: { id: params.id } }),
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
  ]);

  if (!site) notFound();

  const action = updateSite.bind(null, site.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/sites/${site.id}`}
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Back to site
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Edit {site.name}
        </h1>
      </div>

      <SiteForm
        action={action}
        initial={{
          id: site.id,
          code: site.code,
          name: site.name,
          addressLine: site.addressLine,
          postcode: site.postcodeFormatted || site.postcode,
          city: site.city,
          type: site.type,
          regionId: site.regionId,
          customerId: site.customerId,
          partnerId: site.partnerId,
          services: site.services,
          riskLevel: site.riskLevel,
          notes: site.notes,
          active: site.active,
        }}
        regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        customers={customers}
        partners={partners}
        submitLabel="Save changes"
      />
    </div>
  );
}
