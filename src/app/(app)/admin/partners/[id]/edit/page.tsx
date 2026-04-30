import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PartnerForm } from "../../_components/PartnerForm";
import { updatePartner } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditPartnerPage({
  params,
}: {
  params: { id: string };
}) {
  const partner = await prisma.partner.findUnique({
    where: { id: params.id },
    include: { contacts: { orderBy: { name: "asc" } } },
  });
  if (!partner) notFound();

  const action = updatePartner.bind(null, partner.id);

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
          Edit {partner.name}
        </h1>
      </div>
      <PartnerForm
        action={action}
        submitLabel="Save changes"
        initial={{
          id: partner.id,
          name: partner.name,
          role: partner.role,
          preferred: partner.preferred,
          emailIntake: partner.emailIntake,
          notes: partner.notes,
          active: partner.active,
          contacts: partner.contacts.map((c) => ({
            id: c.id,
            name: c.name,
            role: c.role,
            email: c.email,
            phone: c.phone,
            notes: c.notes,
          })),
        }}
      />
    </div>
  );
}
