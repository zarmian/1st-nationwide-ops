"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { geocodePostcodes } from "@/lib/geocode";

/**
 * Best-effort geocode of one postcode → { lat, lng }. Returns null on any
 * failure (geocodePostcodes already swallows network errors) so a lookup
 * miss never blocks saving a site.
 */
async function geocodeOne(
  postcode: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!postcode) return null;
  try {
    const coords = await geocodePostcodes([postcode]);
    return Array.from(coords.values())[0] ?? null;
  } catch {
    return null;
  }
}

const SITE_TYPES = [
  "COMMERCIAL",
  "RESIDENTIAL",
  "RETAIL",
  "STORAGE",
  "INDUSTRIAL",
  "OTHER",
] as const;

const SERVICE_TAGS = [
  "ALARM_RESPONSE",
  "KEYHOLDING",
  "LOCKUP",
  "UNLOCK",
  "VPI",
  "PATROL",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
] as const;

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const KEY_TYPES = ["KEY", "FOB", "PADLOCK", "CODE"] as const;
const KEY_STATUSES = [
  "WITH_US",
  "WITH_OFFICER",
  "WITH_CUSTOMER",
  "LOST",
  "RETIRED",
] as const;
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const FREQUENCIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;

const KeyRow = z.object({
  id: z.string().uuid().optional().nullable(),
  internalNo: z.string().trim().max(40).optional().nullable(),
  label: z.string().trim().min(1).max(120),
  type: z.enum(KEY_TYPES),
  status: z.enum(KEY_STATUSES).default("WITH_US"),
  duplicable: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
  remove: z.boolean().optional(),
});

const KeySetRow = z.object({
  id: z.string().uuid().optional().nullable(),
  internalNo: z.string().trim().max(40).optional().nullable(),
  label: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(500).optional().nullable(),
  // Reference photo of the physical bunch — Vercel Blob URL. Mirrors
  // the field already on /key-sets/[id]; bringing it into the site
  // form means a new set can ship with a photo on day one.
  photoUrl: z
    .string()
    .url()
    .or(z.literal(""))
    .optional()
    .nullable(),
  keys: z.array(KeyRow).max(50).default([]),
  remove: z.boolean().optional(),
});

const IsoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const ScheduleDay = z.object({
  dayOfWeek: z.enum(DAYS),
  frequency: z.enum(FREQUENCIES).default("WEEKLY"),
  // Legacy single time — still accepted from older payloads.
  timeOfDay: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM")
    .optional()
    .nullable(),
  // Ordered list of patrol times for the day. One visit is created per time;
  // times earlier than the previous one roll past midnight (see
  // resolvePatrolSlots). Empty → falls back to timeOfDay / the kind default.
  times: z
    .array(z.string().trim().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"))
    .default([]),
  startsOn: IsoDate.optional().nullable(),
  endsOn: IsoDate.optional().nullable(),
  assignedOfficerId: z
    .string()
    .uuid()
    .or(z.literal(""))
    .optional()
    .nullable(),
  intervalWeeks: z.number().int().min(1).max(52).optional().nullable(),
  exceptionDates: z.array(IsoDate).default([]),
});

const SiteInput = z.object({
  code: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(1, "Name is required").max(200),
  addressLine: z.string().trim().min(1, "Address is required").max(300),
  postcode: z.string().trim().min(2, "Postcode is required").max(12),
  city: z.string().trim().max(80).optional().nullable(),
  type: z.enum(SITE_TYPES),
  regionId: z.coerce.number().int().positive().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  partnerId: z.string().uuid().optional().nullable(),
  services: z.array(z.enum(SERVICE_TAGS)).default([]),
  riskLevel: z.enum(RISK_LEVELS).default("LOW"),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().default(true),
  partnerReference: z.string().trim().max(80).optional().nullable(),
  partnerSin: z.string().trim().max(80).optional().nullable(),
  sapRef: z.string().trim().max(80).optional().nullable(),
  opsUnit: z.string().trim().max(80).optional().nullable(),
  what3words: z.string().trim().max(120).optional().nullable(),
  partnerStatus: z.string().trim().max(40).optional().nullable(),
  startDate: z.string().trim().optional().nullable(),
  terminationDate: z.string().trim().optional().nullable(),
  dne: z.boolean().default(false),
  hsMarkers: z.boolean().default(false),

  keySets: z.array(KeySetRow).max(20).default([]),
  lockUnlock: z
    .object({
      days: z.array(z.enum(DAYS)).default([]),
      unlockTime: z.string().trim().max(8).optional().nullable(),
      lockdownTime: z.string().trim().max(8).optional().nullable(),
      assignedOfficerId: z.string().uuid().optional().nullable(),
    })
    .optional(),
  patrolDays: z.array(ScheduleDay).max(7).default([]),
  vpiDays: z.array(ScheduleDay).max(7).default([]),
  access: z
    .object({
      alarmCode: z.string().trim().max(60).optional().nullable(),
      padlockCode: z.string().trim().max(60).optional().nullable(),
      entryStepsMd: z.string().trim().max(4000).optional().nullable(),
      lockboxId: z.string().trim().max(60).optional().nullable(),
      hazards: z.string().trim().max(1000).optional().nullable(),
    })
    .optional(),
});

export type SiteFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function normalisePostcode(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(pc: string): string {
  const n = normalisePostcode(pc);
  if (n.length < 5) return pc.toUpperCase().trim();
  return `${n.slice(0, n.length - 3)} ${n.slice(-3)}`;
}

function scheduleRowFromInput(
  siteId: string,
  kind: "PATROL" | "VPI",
  p: z.infer<typeof ScheduleDay>,
) {
  // Prefer the times list; fall back to the legacy single time. Keep
  // timeOfDay in sync with times[0] for any old readers.
  const times = p.times && p.times.length > 0
    ? p.times
    : p.timeOfDay
      ? [p.timeOfDay]
      : [];
  return {
    siteId,
    kind: kind as any,
    dayOfWeek: p.dayOfWeek as any,
    frequency: p.frequency as any,
    timeOfDay: times[0] ?? p.timeOfDay ?? null,
    timesOfDay: times,
    startsOn: p.startsOn ? new Date(`${p.startsOn}T00:00:00Z`) : null,
    endsOn: p.endsOn ? new Date(`${p.endsOn}T23:59:59Z`) : null,
    assignedOfficerId:
      p.assignedOfficerId && p.assignedOfficerId !== ""
        ? p.assignedOfficerId
        : null,
    intervalWeeks: p.intervalWeeks ?? null,
    exceptionDates: p.exceptionDates ?? [],
    active: true,
  };
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseFormData(formData: FormData) {
  const services = formData.getAll("services").map(String);
  const lockunlockDays = formData.getAll("lockunlock_days").map(String);

  const raw = {
    code: formData.get("code")?.toString() || null,
    name: formData.get("name")?.toString() ?? "",
    addressLine: formData.get("addressLine")?.toString() ?? "",
    postcode: formData.get("postcode")?.toString() ?? "",
    city: formData.get("city")?.toString() || null,
    type: formData.get("type")?.toString() ?? "COMMERCIAL",
    regionId: formData.get("regionId")?.toString() || null,
    customerId: formData.get("customerId")?.toString() || null,
    partnerId: formData.get("partnerId")?.toString() || null,
    services,
    riskLevel: formData.get("riskLevel")?.toString() ?? "LOW",
    notes: formData.get("notes")?.toString() || null,
    active: formData.get("active") === "on",
    partnerReference: formData.get("partnerReference")?.toString() || null,
    partnerSin: formData.get("partnerSin")?.toString() || null,
    sapRef: formData.get("sapRef")?.toString() || null,
    opsUnit: formData.get("opsUnit")?.toString() || null,
    what3words: formData.get("what3words")?.toString() || null,
    partnerStatus: formData.get("partnerStatus")?.toString() || null,
    startDate: formData.get("startDate")?.toString() || null,
    terminationDate: formData.get("terminationDate")?.toString() || null,
    dne: formData.get("dne") === "on",
    hsMarkers: formData.get("hsMarkers") === "on",

    keySets: safeJson(
      formData.get("keysets_json")?.toString(),
      [] as unknown[],
    ),
    lockUnlock: {
      days: lockunlockDays,
      unlockTime: formData.get("lockunlock_unlock_time")?.toString() || null,
      lockdownTime:
        formData.get("lockunlock_lockdown_time")?.toString() || null,
      assignedOfficerId:
        formData.get("lockunlock_assigned_officer_id")?.toString() || null,
    },
    patrolDays: safeJson(
      formData.get("patrol_days_json")?.toString(),
      [] as unknown[],
    ),
    vpiDays: safeJson(
      formData.get("vpi_days_json")?.toString(),
      [] as unknown[],
    ),
    access: {
      alarmCode: formData.get("access_alarm_code")?.toString() || null,
      padlockCode: formData.get("access_padlock_code")?.toString() || null,
      entryStepsMd: formData.get("access_entry_steps")?.toString() || null,
      lockboxId: formData.get("access_lockbox_id")?.toString() || null,
      hazards: formData.get("access_hazards")?.toString() || null,
    },
  };
  return SiteInput.safeParse(raw);
}

type ParsedSite = z.infer<typeof SiteInput>;

async function syncRelations(siteId: string, d: ParsedSite) {
  const services = new Set(d.services);
  const wantsKeys = services.has("KEYHOLDING");
  const wantsLockUnlock = services.has("LOCKUP") || services.has("UNLOCK");
  const wantsPatrol = services.has("PATROL");
  const wantsVpi = services.has("VPI");
  const wantsAccess = services.has("ALARM_RESPONSE");

  await prisma.$transaction(async (tx) => {
    // ── Keys ──────────────────────────────────────────────────────────────
    if (wantsKeys) {
      for (const set of d.keySets) {
        let setId = set.id ?? null;

        if (set.id) {
          if (set.remove) {
            // Soft-retire: deactivate set, retire its keys.
            await tx.keySet.update({
              where: { id: set.id },
              data: { active: false },
            });
            await tx.key.updateMany({
              where: { keySetId: set.id },
              data: { status: "RETIRED" as any },
            });
            continue;
          }
          await tx.keySet.update({
            where: { id: set.id },
            data: {
              internalNo: set.internalNo || null,
              label: set.label,
              notes: set.notes || null,
              photoUrl: set.photoUrl || null,
              active: true,
            },
          });
        } else if (!set.remove) {
          const created = await tx.keySet.create({
            data: {
              siteId,
              internalNo: set.internalNo || null,
              label: set.label,
              notes: set.notes || null,
              photoUrl: set.photoUrl || null,
            },
            select: { id: true },
          });
          setId = created.id;
        } else {
          continue;
        }

        for (const k of set.keys) {
          if (k.id) {
            await tx.key.update({
              where: { id: k.id },
              data: {
                keySetId: setId,
                internalNo: k.internalNo || null,
                label: k.label,
                type: k.type as any,
                status: (k.remove ? "RETIRED" : k.status) as any,
                duplicable: k.duplicable,
                notes: k.notes || null,
              },
            });
          } else if (!k.remove && setId) {
            await tx.key.create({
              data: {
                siteId,
                keySetId: setId,
                internalNo: k.internalNo || null,
                label: k.label,
                type: k.type as any,
                status: k.status as any,
                duplicable: k.duplicable,
                notes: k.notes || null,
              },
            });
          }
        }
      }
    }

    // ── Lock/unlock schedule ─────────────────────────────────────────────
    const existingLU = await tx.lockUnlockSchedule.findFirst({
      where: { siteId },
      select: { id: true },
    });
    if (wantsLockUnlock && d.lockUnlock) {
      const data = {
        days: d.lockUnlock.days as any,
        unlockTime: d.lockUnlock.unlockTime || null,
        lockdownTime: d.lockUnlock.lockdownTime || null,
        assignedOfficerId: d.lockUnlock.assignedOfficerId || null,
        active: true,
      };
      if (existingLU) {
        await tx.lockUnlockSchedule.update({
          where: { id: existingLU.id },
          data,
        });
      } else {
        await tx.lockUnlockSchedule.create({ data: { ...data, siteId } });
      }
    } else if (existingLU) {
      await tx.lockUnlockSchedule.update({
        where: { id: existingLU.id },
        data: { active: false },
      });
    }

    // ── Patrol schedules ─────────────────────────────────────────────────
    await tx.patrolSchedule.deleteMany({
      where: { siteId, kind: "PATROL" },
    });
    if (wantsPatrol && d.patrolDays.length) {
      await tx.patrolSchedule.createMany({
        data: d.patrolDays.map((p) => scheduleRowFromInput(siteId, "PATROL", p)),
      });
    }

    // ── VPI schedules ────────────────────────────────────────────────────
    await tx.patrolSchedule.deleteMany({
      where: { siteId, kind: "VPI" },
    });
    if (wantsVpi && d.vpiDays.length) {
      await tx.patrolSchedule.createMany({
        data: d.vpiDays.map((p) => scheduleRowFromInput(siteId, "VPI", p)),
      });
    }

    // ── Access instruction (alarm codes etc.) ────────────────────────────
    if (wantsAccess && d.access) {
      const existingAI = await tx.accessInstruction.findUnique({
        where: { siteId },
        select: { id: true },
      });
      // Encrypted at rest — plaintext columns are deprecated and cleared on
      // write so they don't drift from the encrypted source of truth.
      const data = {
        alarmCodeEnc: encryptString(d.access.alarmCode),
        padlockCodeEnc: encryptString(d.access.padlockCode),
        alarmCode: null,
        padlockCode: null,
        entryStepsMd: d.access.entryStepsMd || null,
        lockboxId: d.access.lockboxId || null,
        hazards: d.access.hazards || null,
      };
      if (existingAI) {
        await tx.accessInstruction.update({
          where: { siteId },
          data,
        });
      } else {
        await tx.accessInstruction.create({
          data: { ...data, siteId },
        });
      }
    }
  });
}

export async function createSite(
  _prev: SiteFormState,
  formData: FormData,
): Promise<SiteFormState> {
  await requireStaff();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  if (d.code) {
    const dup = await prisma.site.findUnique({ where: { code: d.code } });
    if (dup) {
      return {
        error: "A site with this code already exists.",
        fieldErrors: { code: ["Code must be unique"] },
      };
    }
  }

  // Geocode the postcode so the new site shows on the map straight away.
  const coords = await geocodeOne(d.postcode);

  const created = await prisma.site.create({
    data: {
      code: d.code || null,
      name: d.name,
      addressLine: d.addressLine,
      postcode: normalisePostcode(d.postcode),
      postcodeFormatted: formatPostcode(d.postcode),
      city: d.city || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      type: d.type as any,
      regionId: d.regionId ?? null,
      customerId: d.customerId || null,
      partnerId: d.partnerId || null,
      services: d.services as any,
      riskLevel: d.riskLevel as any,
      notes: d.notes || null,
      active: d.active,
      partnerReference: d.partnerReference || null,
      partnerSin: d.partnerSin || null,
      sapRef: d.sapRef || null,
      opsUnit: d.opsUnit || null,
      what3words: d.what3words || null,
      partnerStatus: d.partnerStatus || null,
      startDate: d.startDate ? new Date(d.startDate) : null,
      terminationDate: d.terminationDate ? new Date(d.terminationDate) : null,
      dne: d.dne,
      hsMarkers: d.hsMarkers,
    },
    select: { id: true },
  });

  await syncRelations(created.id, d);

  revalidatePath("/sites");
  redirect(`/sites/${created.id}`);
}

export async function updateSite(
  id: string,
  _prev: SiteFormState,
  formData: FormData,
): Promise<SiteFormState> {
  await requireStaff();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  if (d.code) {
    const dup = await prisma.site.findFirst({
      where: { code: d.code, NOT: { id } },
      select: { id: true },
    });
    if (dup) {
      return {
        error: "A different site already uses this code.",
        fieldErrors: { code: ["Code must be unique"] },
      };
    }
  }

  // Re-geocode when the postcode changed or coordinates are still missing,
  // so an edit can put a site on the map (or move its pin). Keep the
  // existing coords otherwise.
  const before = await prisma.site.findUnique({
    where: { id },
    select: { postcode: true, lat: true, lng: true },
  });
  const newPostcodeNorm = normalisePostcode(d.postcode);
  const postcodeChanged =
    !before || normalisePostcode(before.postcode) !== newPostcodeNorm;
  const needsGeocode =
    postcodeChanged || before?.lat == null || before?.lng == null;
  const coords = needsGeocode ? await geocodeOne(d.postcode) : null;

  await prisma.site.update({
    where: { id },
    data: {
      code: d.code || null,
      name: d.name,
      addressLine: d.addressLine,
      postcode: normalisePostcode(d.postcode),
      postcodeFormatted: formatPostcode(d.postcode),
      city: d.city || null,
      // Only overwrite coords when we actually got a fresh fix; never wipe
      // good coordinates because a one-off lookup failed.
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      type: d.type as any,
      regionId: d.regionId ?? null,
      customerId: d.customerId || null,
      partnerId: d.partnerId || null,
      services: d.services as any,
      riskLevel: d.riskLevel as any,
      notes: d.notes || null,
      active: d.active,
      partnerReference: d.partnerReference || null,
      partnerSin: d.partnerSin || null,
      sapRef: d.sapRef || null,
      opsUnit: d.opsUnit || null,
      what3words: d.what3words || null,
      partnerStatus: d.partnerStatus || null,
      startDate: d.startDate ? new Date(d.startDate) : null,
      terminationDate: d.terminationDate ? new Date(d.terminationDate) : null,
      dne: d.dne,
      hsMarkers: d.hsMarkers,
    },
  });

  await syncRelations(id, d);

  revalidatePath("/sites");
  revalidatePath(`/sites/${id}`);
  redirect(`/sites/${id}`);
}

const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  customerId: z.string().uuid().nullable().optional(),
  partnerId: z.string().uuid().nullable().optional(),
  regionId: z.coerce.number().int().positive().nullable().optional(),
});

export type BulkUpdateResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function bulkUpdateSites(input: {
  ids: string[];
  customerId: string | null | undefined;
  partnerId: string | null | undefined;
  regionId: number | null | undefined;
}): Promise<BulkUpdateResult> {
  await requireStaff();
  const parsed = BulkInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid selection." };
  }
  const { ids, customerId, partnerId, regionId } = parsed.data;

  const data: {
    customerId?: string | null;
    partnerId?: string | null;
    regionId?: number | null;
  } = {};
  if (customerId !== undefined) data.customerId = customerId;
  if (partnerId !== undefined) data.partnerId = partnerId;
  if (regionId !== undefined) data.regionId = regionId;

  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Nothing to change." };
  }

  const res = await prisma.site.updateMany({
    where: { id: { in: ids } },
    data,
  });

  revalidatePath("/sites");
  return { ok: true, count: res.count };
}
