/**
 * Merge a duplicate site record into the real one. Every job, patrol, shift,
 * schedule, key, report and alarm moves across. The partner's references (e.g.
 * the Nexus SITE-… number) move too, so the nightly Nexus site sync keeps the
 * real record up to date instead of the copy. The copy is switched off and
 * kept, empty, for the history.
 *
 * Where a site can only have one (its access instructions, one rate per
 * service), the real site keeps its own and the copy's stays behind.
 * Idempotent: once merged, a re-run finds nothing left to move.
 *
 * SITE_MERGES lists the merges the office has asked for. They run nightly from
 * the patrol-visits cron, and on demand from Patrols → Clean up duplicates,
 * before the Nexus clean-up (which can then match Nexus's jobs to our patrols).
 */
import type { PrismaClient } from "@prisma/client";
import { ukDayString } from "@/lib/dates";

export const SITE_MERGES: { from: string; into: string }[] = [
  // Swail House: the Nexus site import made "Swail House" (SITE-119621)
  // alongside "Swail House, Ashley Road, Epsom, KT18 5AZ", which the office
  // had set up with the weekend patrol schedule. Nexus's jobs landed on one
  // and our patrols on the other, so they were never matched. (Oct 2026)
  {
    from: "1d2a1253-6542-4b41-a92b-634d1992fd61",
    into: "8528e5f7-444e-4fa6-b9c9-ffdc2bd86df8",
  },
];

export type SiteMergeResult = {
  from: string;
  into: string;
  /** Records moved, by kind (only kinds that had any). */
  moved: Record<string, number>;
  /** False when there was nothing left to do (already merged). */
  changed: boolean;
};

/** Partner metadata the real site takes from the copy when it has none. */
const CARRY = ["partnerId", "partnerReference", "partnerSin", "sapRef", "opsUnit", "partnerStatus", "what3words"] as const;

const SITE_SELECT = {
  id: true,
  name: true,
  active: true,
  notes: true,
  services: true,
  partnerId: true,
  partnerReference: true,
  partnerSin: true,
  sapRef: true,
  opsUnit: true,
  partnerStatus: true,
  what3words: true,
} as const;

export async function mergeSiteInto(
  prisma: PrismaClient,
  fromId: string,
  intoId: string,
  opts: { userId?: string | null; now?: Date } = {},
): Promise<SiteMergeResult | null> {
  if (fromId === intoId) return null;
  return prisma.$transaction(async (tx) => {
    const from = await tx.site.findUnique({ where: { id: fromId }, select: SITE_SELECT });
    const into = await tx.site.findUnique({ where: { id: intoId }, select: SITE_SELECT });
    if (!from || !into) return null;

    const moved: Record<string, number> = {};
    const where = { siteId: fromId };
    const data = { siteId: intoId };
    const count = (name: string, n: number) => {
      if (n > 0) moved[name] = n;
    };
    count("jobs", (await tx.job.updateMany({ where, data })).count);
    count("patrolVisits", (await tx.patrolVisit.updateMany({ where, data })).count);
    count("patrolSchedules", (await tx.patrolSchedule.updateMany({ where, data })).count);
    count("lockUnlockSchedules", (await tx.lockUnlockSchedule.updateMany({ where, data })).count);
    count("shifts", (await tx.shift.updateMany({ where, data })).count);
    count("alarmEvents", (await tx.alarmEvent.updateMany({ where, data })).count);
    count("keySets", (await tx.keySet.updateMany({ where, data })).count);
    count("keys", (await tx.key.updateMany({ where, data })).count);
    count("formSubmissions", (await tx.formSubmission.updateMany({ where, data })).count);
    count("formTemplates", (await tx.formTemplate.updateMany({ where, data })).count);
    count("fastfieldReports", (await tx.fastFieldReport.updateMany({ where, data })).count);
    count("onboardingPipelines", (await tx.onboardingPipeline.updateMany({ where, data })).count);
    // One per site: the real site's own wins.
    if (!(await tx.accessInstruction.findUnique({ where: { siteId: intoId }, select: { id: true } }))) {
      count("accessInstructions", (await tx.accessInstruction.updateMany({ where, data })).count);
    }
    const priced = (await tx.siteRate.findMany({ where: { siteId: intoId }, select: { service: true } })).map(
      (r) => r.service,
    );
    count(
      "rates",
      (await tx.siteRate.updateMany({ where: { siteId: fromId, service: { notIn: priced } }, data })).count,
    );

    const carry: Record<string, unknown> = {};
    for (const f of CARRY) {
      if (into[f] == null && from[f] != null) carry[f] = from[f];
    }
    const services = Array.from(new Set([...into.services, ...from.services]));
    const addsServices = services.length > into.services.length;
    const copyLooksLive = from.active || from.partnerReference != null || from.partnerSin != null;

    if (Object.keys(moved).length === 0 && Object.keys(carry).length === 0 && !addsServices && !copyLooksLive) {
      return { from: from.name, into: into.name, moved, changed: false };
    }

    const day = ukDayString(opts.now ?? new Date());
    // Clear the copy's partner references first, so the Nexus site sync and
    // the Nexus imports only ever find the real site.
    await tx.site.update({
      where: { id: fromId },
      data: {
        active: false,
        partnerReference: null,
        partnerSin: null,
        notes: `${from.notes ? `${from.notes}\n` : ""}[${day}] Duplicate of “${into.name}” — merged into it; its records moved there.`,
      },
    });
    await tx.site.update({
      where: { id: intoId },
      data: { ...carry, ...(addsServices ? { services: services as never } : {}) },
    });
    const diff = { mergedSite: { from: fromId, to: intoId }, moved };
    await tx.activityLog.create({
      data: { entity: "Site", entityId: intoId, action: "merged_site", userId: opts.userId ?? null, diff },
    });
    await tx.activityLog.create({
      data: { entity: "Site", entityId: fromId, action: "merged_site", userId: opts.userId ?? null, diff },
    });
    return { from: from.name, into: into.name, moved, changed: true };
  });
}

/** Run every merge in SITE_MERGES. Errors are logged by code and skipped. */
export async function runSiteMerges(
  prisma: PrismaClient,
  opts: { userId?: string | null } = {},
): Promise<SiteMergeResult[]> {
  const out: SiteMergeResult[] = [];
  for (const m of SITE_MERGES) {
    try {
      const r = await mergeSiteInto(prisma, m.from, m.into, opts);
      if (r?.changed) out.push(r);
    } catch (e) {
      console.error(
        "Site merge failed:",
        (e as { code?: string })?.code ?? (e as Error)?.name ?? "error",
      );
    }
  }
  return out;
}
