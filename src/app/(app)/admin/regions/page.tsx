import Link from "next/link";
import { prisma } from "@/lib/db";
import { RegionsManager } from "./_components/RegionsManager";

export const dynamic = "force-dynamic";

export default async function RegionsAdminPage() {
  const regions = await prisma.region.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { sites: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 hover:text-brand-mint-dark">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">Regions</h1>
        <p className="text-sm text-slate-500">
          Operating regions used to group sites and officers.
        </p>
      </div>

      <RegionsManager
        regions={regions.map((r) => ({
          id: r.id,
          name: r.name,
          notes: r.notes,
          siteCount: r._count.sites,
        }))}
      />
    </div>
  );
}
