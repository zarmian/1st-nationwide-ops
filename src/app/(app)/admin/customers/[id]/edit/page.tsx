import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CustomerForm } from "../../_components/CustomerForm";
import { updateCustomer } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: { id: string };
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: { contacts: { orderBy: { name: "asc" } } },
  });
  if (!customer) notFound();

  const action = updateCustomer.bind(null, customer.id);

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
          Edit {customer.name}
        </h1>
      </div>
      <CustomerForm
        action={action}
        submitLabel="Save changes"
        initial={{
          id: customer.id,
          name: customer.name,
          type: customer.type,
          billingAddress: customer.billingAddress,
          contractRef: customer.contractRef,
          contractStart: customer.contractStart
            ? customer.contractStart.toISOString().slice(0, 10)
            : null,
          contractEnd: customer.contractEnd
            ? customer.contractEnd.toISOString().slice(0, 10)
            : null,
          notes: customer.notes,
          active: customer.active,
          contacts: customer.contacts.map((c) => ({
            id: c.id,
            name: c.name,
            role: c.role,
            email: c.email,
            phone: c.phone,
            ref: c.ref,
            notes: c.notes,
          })),
        }}
      />
    </div>
  );
}
