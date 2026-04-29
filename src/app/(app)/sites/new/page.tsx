import Link from "next/link";
import { prisma } from "@/lib/db";
import { SiteForm } from "../_components/SiteForm";
import { createSite } from "../_actions";

export const dynamic = "force-dynamic";

export default async function NewSitePage() {
  const [regions, customers, partners] = await Promise.all([
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

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/sites"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Back to sites
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">New site</h1>
      </div>

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
        }}
        regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        customers={customers}
        partners={partners}
        submitLabel="Create site"
      />
    </div>
  );
}
