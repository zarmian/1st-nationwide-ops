import Link from "next/link";
import { CustomerForm } from "../_components/CustomerForm";
import { createCustomer } from "../_actions";

export const dynamic = "force-dynamic";

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/customers"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Customers
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New customer
        </h1>
      </div>
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
          contacts: [],
        }}
      />
    </div>
  );
}
