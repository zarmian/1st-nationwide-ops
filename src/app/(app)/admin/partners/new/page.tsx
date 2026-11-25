import { PartnerForm } from "../_components/PartnerForm";
import { createPartner } from "../_actions";
import { PageHeader } from "@/components/PageHeader";
import { requireAdminPage } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function NewPartnerPage() {
  await requireAdminPage();
  return (
    <div className="space-y-4">
      <PageHeader
        title="New partner"
        backHref="/admin/partners"
        backLabel="Partners"
      />
      <PartnerForm
        action={createPartner}
        submitLabel="Create partner"
        initial={{
          name: "",
          role: "CUSTOMER",
          preferred: "EMAIL",
          emailIntake: null,
          notes: null,
          active: true,
          hidden: false,
          contacts: [],
        }}
      />
    </div>
  );
}
