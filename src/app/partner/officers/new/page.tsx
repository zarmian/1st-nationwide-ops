import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { PartnerOfficerForm } from "../_components/PartnerOfficerForm";
import { createPartnerOfficer } from "../_actions";

export const dynamic = "force-dynamic";

export default async function NewPartnerOfficerPage() {
  await requirePartner();
  return (
    <div className="space-y-4">
      <PageHeader
        title="New officer"
        backHref="/partner/officers"
        backLabel="Officers"
        subtitle="Adds someone to your private roster. They won't appear on 1NW's officer list."
      />
      <PartnerOfficerForm
        action={createPartnerOfficer}
        submitLabel="Add officer"
        initial={{
          name: "",
          phone: null,
          siaNumber: null,
          notes: null,
          active: true,
        }}
      />
    </div>
  );
}
