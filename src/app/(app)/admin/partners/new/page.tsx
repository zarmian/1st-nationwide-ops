import Link from "next/link";
import { PartnerForm } from "../_components/PartnerForm";
import { createPartner } from "../_actions";

export const dynamic = "force-dynamic";

export default function NewPartnerPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/partners"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Partners
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New partner
        </h1>
      </div>
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
          contacts: [],
        }}
      />
    </div>
  );
}
