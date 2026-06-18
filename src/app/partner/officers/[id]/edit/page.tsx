import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { PartnerOfficerForm } from "../../_components/PartnerOfficerForm";
import { PartnerOfficerLoginCard } from "../../_components/PartnerOfficerLoginCard";
import { updatePartnerOfficer } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditPartnerOfficerPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requirePartner();
  const officer = await prisma.partnerOfficer.findFirst({
    where: { id: params.id, partnerId: me.partnerId },
    include: {
      user: { select: { email: true, active: true } },
    },
  });
  if (!officer) notFound();

  const action = updatePartnerOfficer.bind(null, officer.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${officer.name}`}
        backHref="/partner/officers"
        backLabel="Officers"
      />
      <PartnerOfficerForm
        action={action}
        submitLabel="Save changes"
        initial={{
          id: officer.id,
          name: officer.name,
          phone: officer.phone,
          siaNumber: officer.siaNumber,
          notes: officer.notes,
          active: officer.active,
        }}
      />
      <PartnerOfficerLoginCard
        initial={{
          officerId: officer.id,
          officerName: officer.name,
          existing: officer.user
            ? { email: officer.user.email, active: officer.user.active }
            : null,
        }}
      />
    </div>
  );
}
