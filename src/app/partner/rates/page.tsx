import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { RateCardForm } from "./_components/RateCardForm";
import { upsertPartnerRate, deletePartnerRate } from "./_actions";

export const dynamic = "force-dynamic";

const SERVICE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  KEYHOLDING: "Keyholding",
  LOCKUP: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  PATROL: "Patrol",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
  ADHOC: "Ad-hoc",
};

/// Order the form rows the way a partner thinks about their work —
/// callouts first, recurring next, shifts last.
const SERVICE_ORDER = [
  "ALARM_RESPONSE",
  "PATROL",
  "VPI",
  "LOCKUP",
  "UNLOCK",
  "KEYHOLDING",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
] as const;

export default async function PartnerRatesPage() {
  const me = await requirePartner();

  const rates = await prisma.partnerRate.findMany({
    where: { partnerId: me.partnerId },
  });
  const byService = new Map(rates.map((r) => [r.service, r]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rate card"
        subtitle="What you charge us and what you pay your officer — one row per service. Auto-fills the activity form; you can still override per record."
      />

      <div className="space-y-2">
        {SERVICE_ORDER.map((service) => {
          const existing = byService.get(service);
          return (
            <RateCardForm
              key={service}
              service={service}
              label={SERVICE_LABEL[service] ?? service}
              initial={
                existing
                  ? {
                      chargeToUs: Number(existing.chargeToUs),
                      payToOfficer: Number(existing.payToOfficer),
                      unit: existing.unit,
                      notes: existing.notes,
                    }
                  : null
              }
              upsert={upsertPartnerRate}
              remove={existing ? deletePartnerRate.bind(null, existing.id) : null}
            />
          );
        })}
      </div>
    </div>
  );
}
