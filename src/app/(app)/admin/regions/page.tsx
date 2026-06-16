import { prisma } from "@/lib/db";
import { RegionsManager } from "./_components/RegionsManager";
import { PageHeader } from "@/components/PageHeader";

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
      <PageHeader
        title="Regions"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Operating regions used to group sites and officers."
      />

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
