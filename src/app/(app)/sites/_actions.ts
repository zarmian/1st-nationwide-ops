"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  keys: z.array(KeyRow).max(50).default([]),
  remove: z.boolean().optional(),
});

const ScheduleDay = z.object({
  dayOfWeek: z.enum(DAYS),
  frequency: z.enum(FREQUENCIES).default("WEEKLY"),
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

  keySets: z.array(KeySetRow).max(20).default([]),
  lockUnlock: z
    .object({
      days: z.array(z.enum(DAYS)).default([]),
      unlockTime: z.string().trim().max(8).optional().nullable(),
      lockdownTime: z.string().trim().max(8).optional().nullable(),
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

    keySets: safeJson(
      formData.get("keysets_json")?.toString(),
      [] as unknown[],
    ),
    lockUnlock: {
      days: lockunlockDays,
      unlockTime: formData.get("lockunlock_unlock_time")?.toString() || null,
      lockdownTime:
        formData.get("lockunlock_lockdown_time")?.toString() || null,
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

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    throw new Error("Not authorised");
  }
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
        data: d.patrolDays.map((p) => ({
          siteId,
          kind: "PATROL" as any,
          dayOfWeek: p.dayOfWeek as any,
          frequency: p.frequency as any,
          active: true,
        })),
      });
    }

    // ── VPI schedules ────────────────────────────────────────────────────
    await tx.patrolSchedule.deleteMany({
      where: { siteId, kind: "VPI" },
    });
    if (wantsVpi && d.vpiDays.length) {
      await tx.patrolSchedule.createMany({
        data: d.vpiDays.map((p) => ({
          siteId,
          kind: "VPI" as any,
          dayOfWeek: p.dayOfWeek as any,
          frequency: p.frequency as any,
          active: true,
        })),
      });
    }

    // ── Access instruction (alarm codes etc.) ────────────────────────────
    if (wantsAccess && d.access) {
      const existingAI = await tx.accessInstruction.findUnique({
        where: { siteId },
        select: { id: true },
      });
      const data = {
        alarmCode: d.access.alarmCode || null,
        padlockCode: d.access.padlockCode || null,
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
  await requireAdmin();
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

  const created = await prisma.site.create({
    data: {
      code: d.code || null,
      name: d.name,
      addressLine: d.addressLine,
      postcode: normalisePostcode(d.postcode),
      postcodeFormatted: formatPostcode(d.postcode),
      city: d.city || null,
      type: d.type as any,
      regionId: d.regionId ?? null,
      customerId: d.customerId || null,
      partnerId: d.partnerId || null,
      services: d.services as any,
      riskLevel: d.riskLevel as any,
      notes: d.notes || null,
      active: d.active,
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
  await requireAdmin();
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

  await prisma.site.update({
    where: { id },
    data: {
      code: d.code || null,
      name: d.name,
      addressLine: d.addressLine,
      postcode: normalisePostcode(d.postcode),
      postcodeFormatted: formatPostcode(d.postcode),
      city: d.city || null,
      type: d.type as any,
      regionId: d.regionId ?? null,
      customerId: d.customerId || null,
      partnerId: d.partnerId || null,
      services: d.services as any,
      riskLevel: d.riskLevel as any,
      notes: d.notes || null,
      active: d.active,
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
  await requireAdmin();
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
