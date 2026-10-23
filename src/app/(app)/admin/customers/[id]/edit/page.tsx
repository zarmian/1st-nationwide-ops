import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CustomerForm } from "../../_components/CustomerForm";
import { updateCustomer } from "../../_actions";
import { PageHeader } from "@/components/PageHeader";
import { ClientDashboardCard } from "../_components/ClientDashboardCard";
import { clientLoginUrl } from "@/lib/clientLogin";

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

  const people = await prisma.user.findMany({
    where: { customerId: customer.id, role: "CUSTOMER" },
    orderBy: [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, name: true, email: true, active: true, lastLoginAt: true },
  });

  const action = updateCustomer.bind(null, customer.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${customer.name}`}
        backHref="/admin/customers"
        backLabel="Customers"
      />
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
          hidden: customer.hidden,
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

      <ClientDashboardCard
        customerId={customer.id}
        customerName={customer.name}
        domains={customer.portalEmailDomains}
        loginUrl={clientLoginUrl()}
        people={people}
      />
    </div>
  );
}
