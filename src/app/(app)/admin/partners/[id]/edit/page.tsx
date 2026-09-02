import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PartnerForm } from "../../_components/PartnerForm";
import { updatePartner } from "../../_actions";
import { PageHeader } from "@/components/PageHeader";
import { PartnerLoginCard } from "../_components/PartnerLoginCard";

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

  // Existing PARTNER seat (if any). One row per partner today.
  const existingLogin = await prisma.user.findFirst({
    where: { partnerId: partner.id, role: "PARTNER" },
    orderBy: { createdAt: "desc" },
    select: { email: true, active: true },
  });

  const action = updatePartner.bind(null, partner.id);
  // Only subcontracting partners need portal access (Q1 = a). For
  // CUSTOMER-only partners we hide the login card — they're billed-to
  // accounts, not partners-who-do-work-for-us.
  const showLoginCard =
    partner.role === "SUBCONTRACTOR" || partner.role === "BOTH";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${partner.name}`}
        backHref="/admin/partners"
        backLabel="Partners"
      />
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
          hidden: partner.hidden,
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
      {showLoginCard && (
        <PartnerLoginCard
          initial={{
            partnerId: partner.id,
            partnerName: partner.name,
            existing: existingLogin
              ? { email: existingLogin.email, active: existingLogin.active }
              : null,
          }}
        />
      )}
    </div>
  );
}
