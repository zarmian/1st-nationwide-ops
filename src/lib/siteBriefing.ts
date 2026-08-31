/**
 * On-arrival briefing for an officer attending a site: the site basics, the
 * access instructions (entry steps, hazards, lockbox, alarm/padlock codes) and
 * the keys held for the site.
 *
 * Codes are decrypted HERE (server, nodejs runtime) and only handed to a caller
 * that has authorised the request — see `officerHasCalloutAtSite` and the
 * `getMyCalloutBriefing` server action. They are lazy-loaded (only when the
 * officer opens the briefing), never shipped in the initial page payload.
 */
import { prisma } from "@/lib/db";
import { decryptString, isEncryptionConfigured } from "@/lib/crypto";

export type BriefingKey = {
  label: string;
  internalNo: string | null;
  type: string;
  status: string;
  holder: string | null;
  setLabel: string | null;
};

export type SiteBriefing = {
  siteId: string;
  name: string;
  code: string | null;
  address: string | null;
  postcode: string | null;
  what3words: string | null;
  region: string | null;
  account: string | null;
  access: {
    entrySteps: string | null;
    hazards: string | null;
    lockboxId: string | null;
    /** There is at least one code on file (shown or not). */
    hasCodes: boolean;
    alarmCode: string | null;
    padlockCode: string | null;
    /** A code is stored but can't be shown (encryption key missing / bad row). */
    codesUnavailable: boolean;
  };
  keys: BriefingKey[];
  keySetNote: string | null;
};

/** Prefer the encrypted code; fall back to any legacy plaintext value. */
function decodeCode(
  enc: Uint8Array | null | undefined,
  legacy: string | null | undefined,
): { value: string | null; unavailable: boolean } {
  if (enc && enc.length > 0) {
    if (!isEncryptionConfigured()) return { value: null, unavailable: true };
    try {
      const v = decryptString(enc);
      return v && v.length > 0
        ? { value: v, unavailable: false }
        : { value: null, unavailable: v === null };
    } catch {
      return { value: null, unavailable: true };
    }
  }
  return {
    value: legacy && legacy.length > 0 ? legacy : null,
    unavailable: false,
  };
}

export async function loadSiteBriefing(
  siteId: string,
): Promise<SiteBriefing | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      name: true,
      code: true,
      addressLine: true,
      city: true,
      postcodeFormatted: true,
      what3words: true,
      region: { select: { name: true } },
      customer: { select: { name: true } },
      partner: { select: { name: true } },
      accessInstruction: {
        select: {
          entryStepsMd: true,
          hazards: true,
          lockboxId: true,
          alarmCodeEnc: true,
          padlockCodeEnc: true,
          alarmCode: true,
          padlockCode: true,
        },
      },
      keys: {
        where: { status: { not: "RETIRED" } },
        orderBy: [{ status: "asc" }, { internalNo: "asc" }],
        select: {
          label: true,
          internalNo: true,
          type: true,
          status: true,
          currentHolder: { select: { name: true } },
          keySet: { select: { label: true, notes: true } },
        },
      },
    },
  });
  if (!site) return null;

  const ai = site.accessInstruction;
  const alarm = decodeCode(ai?.alarmCodeEnc, ai?.alarmCode);
  const padlock = decodeCode(ai?.padlockCodeEnc, ai?.padlockCode);

  const keys: BriefingKey[] = site.keys.map((k) => ({
    label: k.label,
    internalNo: k.internalNo,
    type: k.type,
    status: k.status,
    holder: k.currentHolder?.name ?? null,
    setLabel: k.keySet?.label ?? null,
  }));
  const keySetNote =
    site.keys.find((k) => k.keySet?.notes)?.keySet?.notes ?? null;

  return {
    siteId: site.id,
    name: site.name,
    code: site.code,
    address: [site.addressLine, site.city].filter(Boolean).join(", ") || null,
    postcode: site.postcodeFormatted ?? null,
    what3words: site.what3words ?? null,
    region: site.region?.name ?? null,
    account: site.customer?.name
      ? site.customer.name
      : site.partner
        ? `for ${site.partner.name}`
        : null,
    access: {
      entrySteps: ai?.entryStepsMd ?? null,
      hazards: ai?.hazards ?? null,
      lockboxId: ai?.lockboxId ?? null,
      hasCodes: Boolean(
        alarm.value || padlock.value || alarm.unavailable || padlock.unavailable,
      ),
      alarmCode: alarm.value,
      padlockCode: padlock.value,
      codesUnavailable: alarm.unavailable || padlock.unavailable,
    },
    keys,
    keySetNote,
  };
}

/**
 * True when the officer has an active callout (job / patrol visit / shift) at
 * this site — the least-privilege gate for revealing a site's access codes.
 * Unassigned PENDING shifts count: any rostered officer may claim one.
 */
export async function officerHasCalloutAtSite(
  userId: string,
  siteId: string,
): Promise<boolean> {
  const [job, visit, shift] = await Promise.all([
    prisma.job.findFirst({
      where: {
        assignedToUserId: userId,
        siteId,
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
      },
      select: { id: true },
    }),
    prisma.patrolVisit.findFirst({
      where: {
        officerId: userId,
        siteId,
        status: { in: ["PENDING", "LATE", "IN_PROGRESS"] },
      },
      select: { id: true },
    }),
    prisma.shift.findFirst({
      where: {
        OR: [{ officerId: userId }, { officerId: null }],
        siteId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(job || visit || shift);
}
