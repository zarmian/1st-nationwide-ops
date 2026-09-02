import { CustomerForm } from "../_components/CustomerForm";
import { createCustomer } from "../_actions";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="New customer"
        backHref="/admin/customers"
        backLabel="Customers"
      />
      <CustomerForm
        action={createCustomer}
        submitLabel="Create customer"
        initial={{
          name: "",
          type: "CORPORATE",
          billingAddress: null,
          contractRef: null,
          contractStart: null,
          contractEnd: null,
          notes: null,
          active: true,
          hidden: false,
          contacts: [],
        }}
      />
    </div>
  );
}
