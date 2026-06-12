import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SiteForm } from "../../_components/SiteForm";
import { updateSite } from "../../_actions";
import { decryptString } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const [site, regions, customers, partners, officers] = await Promise.all([
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
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!site) notFound();

  const action = updateSite.bind(null, site.id);

  const lu = site.lockUnlockSchedules[0];
  const toIso = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : undefined;
  const projectSchedule = (s: typeof site.patrolSchedules[number]) => ({
    dayOfWeek: s.dayOfWeek,
    frequency: s.frequency,
    timeOfDay: s.timeOfDay ?? undefined,
    startsOn: toIso(s.startsOn),
    endsOn: toIso(s.endsOn),
    assignedOfficerId: s.assignedOfficerId ?? undefined,
    intervalWeeks: s.intervalWeeks ?? undefined,
    exceptionDates: s.exceptionDates ?? [],
  });
  const patrolDays = site.patrolSchedules
    .filter((s) => s.kind === "PATROL")
    .map(projectSchedule);
  const vpiDays = site.patrolSchedules
    .filter((s) => s.kind === "VPI")
    .map(projectSchedule);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/sites/${site.id}`}
          className="text-sm text-slate-500 hover:text-brand-blue-dark"
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
          partnerReference: site.partnerReference,
          partnerSin: site.partnerSin,
          sapRef: site.sapRef,
          opsUnit: site.opsUnit,
          what3words: site.what3words,
          partnerStatus: site.partnerStatus,
          startDate: site.startDate
            ? site.startDate.toISOString().slice(0, 10)
            : null,
          terminationDate: site.terminationDate
            ? site.terminationDate.toISOString().slice(0, 10)
            : null,
          dne: site.dne,
          hsMarkers: site.hsMarkers,
          keySets: [
            ...site.keySets.map((s) => ({
              id: s.id,
              internalNo: s.internalNo,
              label: s.label,
              notes: s.notes,
              photoUrl: s.photoUrl,
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
                    photoUrl: null,
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
            assignedOfficerId: lu?.assignedOfficerId ?? null,
          },
          patrolDays,
          vpiDays,
          access: {
            alarmCode:
              decryptString(site.accessInstruction?.alarmCodeEnc) ??
              site.accessInstruction?.alarmCode ??
              null,
            padlockCode:
              decryptString(site.accessInstruction?.padlockCodeEnc) ??
              site.accessInstruction?.padlockCode ??
              null,
            entryStepsMd: site.accessInstruction?.entryStepsMd ?? null,
            lockboxId: site.accessInstruction?.lockboxId ?? null,
            hazards: site.accessInstruction?.hazards ?? null,
          },
        }}
        regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        customers={customers}
        partners={partners}
        officers={officers}
        submitLabel="Save changes"
      />
    </div>
  );
}
