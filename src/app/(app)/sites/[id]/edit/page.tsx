import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SiteForm } from "../../_components/SiteForm";
import { updateSite } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const [site, regions, customers, partners] = await Promise.all([
    prisma.site.findUnique({
      where: { id: params.id },
      include: {
        keySets: {
          where: { active: true },
          orderBy: { internalNo: "asc" },
          include: {
            keys: {
              where: { status: { not: "RETIRED" } },
              orderBy: { label: "asc" },
            },
          },
        },
        keys: {
          where: { status: { not: "RETIRED" }, keySetId: null },
          orderBy: { label: "asc" },
        },
        lockUnlockSchedules: { where: { active: true }, take: 1 },
        patrolSchedules: { where: { active: true } },
        accessInstruction: true,
      },
    }),
    prisma.region.findMany({ orderBy: { name: "asc" } }),
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!site) notFound();

  const action = updateSite.bind(null, site.id);

  const lu = site.lockUnlockSchedules[0];
  const patrolDays = site.patrolSchedules
    .filter((s) => s.kind === "PATROL")
    .map((s) => ({ dayOfWeek: s.dayOfWeek, frequency: s.frequency }));
  const vpiDays = site.patrolSchedules
    .filter((s) => s.kind === "VPI")
    .map((s) => ({ dayOfWeek: s.dayOfWeek, frequency: s.frequency }));

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/sites/${site.id}`}
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Back to site
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Edit {site.name}
        </h1>
      </div>

      <SiteForm
        action={action}
        initial={{
          id: site.id,
          code: site.code,
          name: site.name,
          addressLine: site.addressLine,
          postcode: site.postcodeFormatted || site.postcode,
          city: site.city,
          type: site.type,
          regionId: site.regionId,
          customerId: site.customerId,
          partnerId: site.partnerId,
          services: site.services,
          riskLevel: site.riskLevel,
          notes: site.notes,
          active: site.active,
          keySets: [
            ...site.keySets.map((s) => ({
              id: s.id,
              internalNo: s.internalNo,
              label: s.label,
              notes: s.notes,
              keys: s.keys.map((k) => ({
                id: k.id,
                internalNo: k.internalNo,
                label: k.label,
                type: k.type,
                status: k.status,
                duplicable: k.duplicable,
                notes: k.notes,
              })),
            })),
            // Migrate any orphan keys (no keySetId) into a default set so
            // they're not lost on first edit after the schema change.
            ...(site.keys.length > 0
              ? [
                  {
                    internalNo: null,
                    label: "Site keys",
                    notes: null,
                    keys: site.keys.map((k) => ({
                      id: k.id,
                      internalNo: k.internalNo,
                      label: k.label,
                      type: k.type,
                      status: k.status,
                      duplicable: k.duplicable,
                      notes: k.notes,
                    })),
                  },
                ]
              : []),
          ],
          lockUnlock: {
            days: lu?.days ?? [],
            unlockTime: lu?.unlockTime ?? null,
            lockdownTime: lu?.lockdownTime ?? null,
          },
          patrolDays,
          vpiDays,
          access: {
            alarmCode: site.accessInstruction?.alarmCode ?? null,
            padlockCode: site.accessInstruction?.padlockCode ?? null,
            entryStepsMd: site.accessInstruction?.entryStepsMd ?? null,
            lockboxId: site.accessInstruction?.lockboxId ?? null,
            hazards: site.accessInstruction?.hazards ?? null,
          },
        }}
        regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        customers={customers}
        partners={partners}
        submitLabel="Save changes"
      />
    </div>
  );
}
