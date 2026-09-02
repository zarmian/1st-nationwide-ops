import { prisma } from "@/lib/db";
import { OfficerForm } from "../_components/OfficerForm";
import { createOfficer } from "../_actions";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewOfficerPage() {
  const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <PageHeader title="New officer" backHref="/officers" backLabel="Officers" />
      <OfficerForm
        action={createOfficer}
        submitLabel="Create officer"
        isCreate
        regions={regions}
        initial={{
          name: "",
          email: "",
          phone: null,
          whatsappNumber: null,
          siaNumber: null,
          siaExpiry: null,
          rightToWorkExpiry: null,
          dbsCheckedOn: null,
          regionId: null,
          role: "OFFICER",
          active: true,
        }}
      />
    </div>
  );
}
