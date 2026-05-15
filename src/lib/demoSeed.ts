/**
 * Demo seeder — populates the database with a coherent set of fake
 * customers / partners / sites / officers / activities so every page in
 * the app has something to render.
 *
 * Safety: every demo entity has a `DEMO-` prefix on its unique field
 * (site code, customer name, partner name, officer email, etc.) so it
 * doesn't collide with real Nexus data. `reset: true` wipes only those
 * demo rows — real data is never touched.
 *
 * Entry points:
 *   - HTTP:  /api/admin/seed-demo?secret=<INIT_SECRET>[&reset=true]
 *   - CLI:   tsx prisma/demo_seed.ts [--reset]
 */
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { encryptString, isEncryptionConfigured } from "@/lib/crypto";
import type { Prisma } from "@prisma/client";

export const DEMO_PREFIX = "DEMO-";
const DEMO_PASSWORD = "DemoOfficer123!";

export type DemoResult = {
  ok: boolean;
  message: string;
  counts: Record<string, number>;
  warnings: string[];
};

// Deterministic PRNG so re-runs give the same result.
let seed = 1234567;
function rng(): number {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}
function ri(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[ri(0, arr.length - 1)];
}
function pickSome<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(pool.splice(ri(0, pool.length - 1), 1)[0]);
  }
  return out;
}

function daysFrom(days: number, hour = 9, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function hoursFrom(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

export async function runDemoSeed(
  opts: { reset?: boolean } = {},
): Promise<DemoResult> {
  // Reset PRNG so counts are deterministic per call.
  seed = 1234567;
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  const existingDemo = await prisma.site.findFirst({
    where: { code: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });

  if (existingDemo && !opts.reset) {
    return {
      ok: false,
      message:
        "Demo data already present. Re-run with ?reset=true to wipe and reseed.",
      counts: {},
      warnings: [],
    };
  }

  if (opts.reset) {
    counts.deleted = await resetDemo();
  }

  // ── Regions ─────────────────────────────────────────────────────────────
  const regionNames = ["DEMO London", "DEMO South East", "DEMO Midlands"];
  const regions = await Promise.all(
    regionNames.map((name) =>
      prisma.region.upsert({
        where: { name },
        create: { name },
        update: {},
      }),
    ),
  );
  counts.regions = regions.length;

  // ── Customers ───────────────────────────────────────────────────────────
  const customerDefs = [
    { name: "DEMO Shurgard UK", type: "CORPORATE" as const, contactName: "Helena Webb" },
    { name: "DEMO Aegis Defence", type: "CORPORATE" as const, contactName: "Marcus Reid" },
    { name: "DEMO Orbis Protect", type: "CORPORATE" as const, contactName: "Pavel Novak" },
    { name: "DEMO Acme Storage Ltd", type: "CORPORATE" as const, contactName: "Sara Ahmed" },
  ];
  const customers = await Promise.all(
    customerDefs.map((c) =>
      prisma.customer.upsert({
        where: { name: c.name },
        create: {
          name: c.name,
          type: c.type,
          contactName: c.contactName,
          contactEmail: `ops+${c.name.toLowerCase().replace(/[^a-z]/g, "")}@demo.example`,
          contactPhone: "+447700900000",
          billingAddress: `${ri(10, 99)} Demo Lane, London, EC1A 1AA`,
          active: true,
        },
        update: {},
      }),
    ),
  );
  counts.customers = customers.length;

  for (const c of customers) {
    await prisma.customerContact.deleteMany({
      where: { customerId: c.id, name: { startsWith: "DEMO" } },
    });
    await prisma.customerContact.createMany({
      data: [
        {
          customerId: c.id,
          name: `DEMO ${c.contactName} (primary)`,
          role: "Operations Manager",
          email: c.contactEmail,
          phone: c.contactPhone,
        },
        {
          customerId: c.id,
          name: "DEMO Out-of-hours desk",
          role: "After-hours contact",
          phone: "+447700900001",
        },
      ],
    });
  }
  counts.customerContacts = customers.length * 2;

  // ── Partners ────────────────────────────────────────────────────────────
  const partnerDefs = [
    {
      name: "DEMO Nexus Security",
      role: "BOTH" as const,
      preferred: "EMAIL" as const,
      emailIntake: "alarms@demo-nexus.example",
    },
    {
      name: "DEMO Keyholding Co",
      role: "BOTH" as const,
      preferred: "EMAIL" as const,
      emailIntake: "ops@demo-keyholding.example",
    },
    {
      name: "DEMO FastGuard Sub",
      role: "SUBCONTRACTOR" as const,
      preferred: "PHONE" as const,
    },
  ];
  const partners = await Promise.all(
    partnerDefs.map((p) =>
      prisma.partner.upsert({
        where: { name: p.name },
        create: p,
        update: {},
      }),
    ),
  );
  counts.partners = partners.length;

  for (const p of partners) {
    await prisma.partnerContact.deleteMany({
      where: { partnerId: p.id, name: { startsWith: "DEMO" } },
    });
    await prisma.partnerContact.createMany({
      data: [
        {
          partnerId: p.id,
          name: "DEMO Duty Manager",
          email: p.emailIntake ?? `duty+${p.name.toLowerCase().replace(/[^a-z]/g, "")}@demo.example`,
          phone: "+447700900100",
          role: "Duty manager",
        },
        {
          partnerId: p.id,
          name: "DEMO Account contact",
          email: `account+${p.name.toLowerCase().replace(/[^a-z]/g, "")}@demo.example`,
          phone: "+447700900101",
          role: "Account contact",
        },
      ],
    });
  }
  counts.partnerContacts = partners.length * 2;

  // ── Users (officers + dispatchers) ──────────────────────────────────────
  const userDefs: {
    email: string;
    name: string;
    role: "OFFICER" | "DISPATCHER";
    regionIdx: number;
    onDuty?: boolean;
  }[] = [
    { email: "demo+officer1@demo.example", name: "DEMO Robert Brown", role: "OFFICER", regionIdx: 0, onDuty: true },
    { email: "demo+officer2@demo.example", name: "DEMO Sarah Mitchell", role: "OFFICER", regionIdx: 0, onDuty: true },
    { email: "demo+officer3@demo.example", name: "DEMO James O'Connor", role: "OFFICER", regionIdx: 1 },
    { email: "demo+officer4@demo.example", name: "DEMO Aisha Khan", role: "OFFICER", regionIdx: 2 },
    { email: "demo+officer5@demo.example", name: "DEMO David Wright", role: "OFFICER", regionIdx: 0 },
    { email: "demo+officer6@demo.example", name: "DEMO Maria Garcia", role: "OFFICER", regionIdx: 1, onDuty: true },
    { email: "demo+officer7@demo.example", name: "DEMO Tomasz Kowalski", role: "OFFICER", regionIdx: 2 },
    { email: "demo+officer8@demo.example", name: "DEMO Mehmet Yilmaz", role: "OFFICER", regionIdx: 0 },
    { email: "demo+dispatcher1@demo.example", name: "DEMO Olivia Chen", role: "DISPATCHER", regionIdx: 0 },
    { email: "demo+dispatcher2@demo.example", name: "DEMO Adam Foster", role: "DISPATCHER", regionIdx: 2 },
  ];
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users: { id: string; name: string; role: string }[] = [];
  for (const u of userDefs) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        regionId: regions[u.regionIdx].id,
        active: true,
        onDuty: !!u.onDuty,
        phone: `+44770090${ri(1000, 9999)}`,
        whatsappNumber: `+44770090${ri(1000, 9999)}`,
        siaNumber: `DEMO-SIA-${String(users.length + 1).padStart(4, "0")}`,
        lastSeenAt: u.onDuty ? hoursFrom(-1) : hoursFrom(-48),
        lastLat: u.onDuty ? 51.5074 + (rng() - 0.5) * 0.1 : null,
        lastLng: u.onDuty ? -0.1278 + (rng() - 0.5) * 0.1 : null,
      },
      update: {
        regionId: regions[u.regionIdx].id,
        onDuty: !!u.onDuty,
      },
      select: { id: true, name: true, role: true },
    });
    users.push(row);
  }
  counts.users = users.length;
  const officers = users.filter((u) => u.role === "OFFICER");

  // ── Sites ───────────────────────────────────────────────────────────────
  type SiteSpec = {
    code: string;
    name: string;
    addressLine: string;
    postcode: string;
    city: string;
    type: "COMMERCIAL" | "RESIDENTIAL" | "RETAIL" | "STORAGE" | "INDUSTRIAL" | "OTHER";
    regionIdx: number;
    customerIdx: number | null;
    partnerIdx: number | null;
    services: string[];
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
  };
  const siteSpecs: SiteSpec[] = [
    // Shurgard storage units (customer 0)
    { code: "DEMO-LON-001", name: "Shurgard Camden", addressLine: "12 Pratt St", postcode: "NW1 0DD", city: "London", type: "STORAGE", regionIdx: 0, customerIdx: 0, partnerIdx: null, services: ["KEYHOLDING", "ALARM_RESPONSE", "LOCKUP", "UNLOCK"], riskLevel: "MEDIUM" },
    { code: "DEMO-LON-002", name: "Shurgard Vauxhall", addressLine: "1 South Lambeth Rd", postcode: "SW8 1SX", city: "London", type: "STORAGE", regionIdx: 0, customerIdx: 0, partnerIdx: null, services: ["KEYHOLDING", "LOCKUP", "UNLOCK", "PATROL"], riskLevel: "LOW" },
    { code: "DEMO-LON-003", name: "Shurgard Stockwell", addressLine: "300 Brixton Rd", postcode: "SW9 6AE", city: "London", type: "STORAGE", regionIdx: 0, customerIdx: 0, partnerIdx: null, services: ["ALARM_RESPONSE", "VPI"], riskLevel: "LOW" },
    { code: "DEMO-SE-001", name: "Shurgard Croydon", addressLine: "33 Purley Way", postcode: "CR0 4XU", city: "Croydon", type: "STORAGE", regionIdx: 1, customerIdx: 0, partnerIdx: null, services: ["KEYHOLDING", "ALARM_RESPONSE", "LOCKUP", "UNLOCK", "PATROL"], riskLevel: "MEDIUM" },
    { code: "DEMO-MID-001", name: "Shurgard Birmingham", addressLine: "8 Aston Lane", postcode: "B6 6QN", city: "Birmingham", type: "STORAGE", regionIdx: 2, customerIdx: 0, partnerIdx: null, services: ["KEYHOLDING", "ALARM_RESPONSE", "PATROL"], riskLevel: "HIGH" },

    // Aegis offices (customer 1)
    { code: "DEMO-LON-004", name: "Aegis HQ", addressLine: "55 Bishopsgate", postcode: "EC2N 3AH", city: "London", type: "COMMERCIAL", regionIdx: 0, customerIdx: 1, partnerIdx: null, services: ["ALARM_RESPONSE", "STATIC_GUARDING"], riskLevel: "HIGH" },
    { code: "DEMO-SE-002", name: "Aegis Reading Office", addressLine: "10 Forbury Rd", postcode: "RG1 1SB", city: "Reading", type: "COMMERCIAL", regionIdx: 1, customerIdx: 1, partnerIdx: null, services: ["ALARM_RESPONSE", "KEYHOLDING"], riskLevel: "MEDIUM" },
    { code: "DEMO-MID-002", name: "Aegis Coventry", addressLine: "2 Greyfriars Rd", postcode: "CV1 3RY", city: "Coventry", type: "COMMERCIAL", regionIdx: 2, customerIdx: 1, partnerIdx: null, services: ["ALARM_RESPONSE", "DOG_HANDLER"], riskLevel: "HIGH" },

    // Orbis (customer 2)
    { code: "DEMO-LON-005", name: "Orbis Wapping", addressLine: "1 Wapping High St", postcode: "E1W 1PJ", city: "London", type: "COMMERCIAL", regionIdx: 0, customerIdx: 2, partnerIdx: null, services: ["VPI", "PATROL"], riskLevel: "MEDIUM" },
    { code: "DEMO-LON-006", name: "Orbis Wembley", addressLine: "10 Olympic Way", postcode: "HA9 0NP", city: "Wembley", type: "COMMERCIAL", regionIdx: 0, customerIdx: 2, partnerIdx: null, services: ["VPI"], riskLevel: "LOW" },

    // Nexus partner-customer sites (partner 0)
    { code: "DEMO-LON-007", name: "Nexus — Mayfair Apartments", addressLine: "8 Park Lane", postcode: "W1K 1AA", city: "London", type: "RESIDENTIAL", regionIdx: 0, customerIdx: null, partnerIdx: 0, services: ["ALARM_RESPONSE", "KEYHOLDING"], riskLevel: "MEDIUM" },
    { code: "DEMO-LON-008", name: "Nexus — Shoreditch Lofts", addressLine: "120 Curtain Rd", postcode: "EC2A 3AH", city: "London", type: "RESIDENTIAL", regionIdx: 0, customerIdx: null, partnerIdx: 0, services: ["ALARM_RESPONSE", "PATROL"], riskLevel: "LOW" },
    { code: "DEMO-LON-009", name: "Nexus — Canary Wharf", addressLine: "1 Westferry Circus", postcode: "E14 4HD", city: "London", type: "COMMERCIAL", regionIdx: 0, customerIdx: null, partnerIdx: 0, services: ["ALARM_RESPONSE", "VPI", "PATROL"], riskLevel: "HIGH" },
    { code: "DEMO-LON-010", name: "Nexus — Tissington Court", addressLine: "135-169 Rotherhithe New Rd", postcode: "SE16 2SD", city: "London", type: "RESIDENTIAL", regionIdx: 0, customerIdx: null, partnerIdx: 0, services: ["ALARM_RESPONSE", "ADHOC"], riskLevel: "MEDIUM" },

    // Keyholding Co partner sites (partner 1)
    { code: "DEMO-SE-003", name: "Keyholding — Brighton Retail", addressLine: "200 Western Rd", postcode: "BN1 2AB", city: "Brighton", type: "RETAIL", regionIdx: 1, customerIdx: null, partnerIdx: 1, services: ["LOCKUP", "UNLOCK", "KEYHOLDING"], riskLevel: "MEDIUM" },
    { code: "DEMO-SE-004", name: "Keyholding — Southampton Mall", addressLine: "10 Above Bar St", postcode: "SO14 7DX", city: "Southampton", type: "RETAIL", regionIdx: 1, customerIdx: null, partnerIdx: 1, services: ["LOCKUP", "UNLOCK"], riskLevel: "LOW" },
    { code: "DEMO-MID-003", name: "Keyholding — Leicester Store", addressLine: "25 Highcross St", postcode: "LE1 4SD", city: "Leicester", type: "RETAIL", regionIdx: 2, customerIdx: null, partnerIdx: 1, services: ["LOCKUP", "UNLOCK", "PATROL"], riskLevel: "MEDIUM" },

    // Mixed / Acme (customer 3)
    { code: "DEMO-MID-004", name: "Acme Warehouse — Wolverhampton", addressLine: "Park Lane", postcode: "WV1 1NJ", city: "Wolverhampton", type: "INDUSTRIAL", regionIdx: 2, customerIdx: 3, partnerIdx: null, services: ["ALARM_RESPONSE", "PATROL", "STATIC_GUARDING"], riskLevel: "HIGH" },
    { code: "DEMO-MID-005", name: "Acme Distribution — Derby", addressLine: "Wyvern Way", postcode: "DE21 6BU", city: "Derby", type: "INDUSTRIAL", regionIdx: 2, customerIdx: 3, partnerIdx: null, services: ["DOG_HANDLER", "ALARM_RESPONSE"], riskLevel: "HIGH" },

    // Onboarding site (no rates yet)
    { code: "DEMO-LON-011", name: "Onboarding — Hackney New Site", addressLine: "20 Mare St", postcode: "E8 4RP", city: "London", type: "COMMERCIAL", regionIdx: 0, customerIdx: null, partnerIdx: 0, services: ["ALARM_RESPONSE"], riskLevel: "LOW" },
  ];

  const sites: { id: string; code: string | null; name: string; spec: SiteSpec }[] = [];
  for (const s of siteSpecs) {
    const row = await prisma.site.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        name: s.name,
        addressLine: s.addressLine,
        postcode: s.postcode.replace(/\s+/g, ""),
        postcodeFormatted: s.postcode,
        city: s.city,
        type: s.type as any,
        regionId: regions[s.regionIdx].id,
        customerId: s.customerIdx != null ? customers[s.customerIdx].id : null,
        partnerId: s.partnerIdx != null ? partners[s.partnerIdx].id : null,
        services: s.services as any,
        riskLevel: s.riskLevel as any,
        active: true,
        lat: 51 + rng() * 2,
        lng: -2 + rng() * 4,
      },
      update: {
        regionId: regions[s.regionIdx].id,
        customerId: s.customerIdx != null ? customers[s.customerIdx].id : null,
        partnerId: s.partnerIdx != null ? partners[s.partnerIdx].id : null,
        services: s.services as any,
      },
      select: { id: true, code: true, name: true },
    });
    sites.push({ ...row, spec: s });
  }
  counts.sites = sites.length;

  // ── Site rates ──────────────────────────────────────────────────────────
  const rateForService: Record<string, number> = {
    KEYHOLDING: 30,
    ALARM_RESPONSE: 75,
    PATROL: 45,
    LOCKUP: 25,
    UNLOCK: 25,
    VPI: 55,
    STATIC_GUARDING: 18, // per hour
    DOG_HANDLER: 26, // per hour
    ADHOC: 60,
  };
  const hourlyServices = new Set(["STATIC_GUARDING", "DOG_HANDLER"]);
  let rateCount = 0;
  for (const s of sites) {
    if (s.code?.includes("LON-011")) continue; // onboarding site, no rates
    for (const svc of s.spec.services) {
      const baseAmt = rateForService[svc] ?? 40;
      const amount = baseAmt + ri(-5, 10);
      const unit = hourlyServices.has(svc) ? "PER_HOUR" : "PER_VISIT";
      await prisma.siteRate.upsert({
        where: { siteId_service: { siteId: s.id, service: svc as any } },
        create: {
          siteId: s.id,
          service: svc as any,
          amount,
          currency: "GBP",
          unit: unit as any,
          includedMinutes: unit === "PER_HOUR" ? 60 : 30,
          excessRatePerMin: unit === "PER_HOUR" ? 0.4 : 0.5,
        },
        update: {},
      });
      rateCount++;
    }
    // Annual subscription + setup
    await prisma.siteRate.upsert({
      where: { siteId_service: { siteId: s.id, service: "ANNUAL_SUBSCRIPTION" as any } },
      create: {
        siteId: s.id,
        service: "ANNUAL_SUBSCRIPTION" as any,
        amount: ri(800, 3500),
        currency: "GBP",
        unit: "FIXED" as any,
      },
      update: {},
    });
    rateCount++;
  }
  counts.siteRates = rateCount;

  // ── Officer rates ───────────────────────────────────────────────────────
  let officerRateCount = 0;
  const officerServices = [
    "ALARM_RESPONSE",
    "KEYHOLDING",
    "PATROL",
    "LOCKUP",
    "UNLOCK",
    "VPI",
    "ADHOC",
    "STATIC_GUARDING",
    "DOG_HANDLER",
  ];
  for (const o of officers) {
    for (const svc of officerServices) {
      const baseAmt = rateForService[svc] ?? 20;
      const officerCut = Math.round(baseAmt * 0.6); // officer keeps ~60%
      const unit = hourlyServices.has(svc) ? "PER_HOUR" : "PER_VISIT";
      await prisma.officerRate.upsert({
        where: { officerId_service: { officerId: o.id, service: svc as any } },
        create: {
          officerId: o.id,
          service: svc as any,
          amount: officerCut,
          currency: "GBP",
          unit: unit as any,
          includedMinutes: unit === "PER_HOUR" ? 60 : 30,
          excessRatePerMin: unit === "PER_HOUR" ? 0.25 : 0.3,
        },
        update: {},
      });
      officerRateCount++;
    }
  }
  counts.officerRates = officerRateCount;

  // ── Access instructions (encrypted alarm codes) ─────────────────────────
  let accessCount = 0;
  if (isEncryptionConfigured()) {
    const accessSites = sites.filter((s) => s.spec.services.includes("ALARM_RESPONSE")).slice(0, 6);
    for (const s of accessSites) {
      const alarmCode = String(ri(1000, 9999));
      const padlockCode = String(ri(100000, 999999));
      await prisma.accessInstruction.upsert({
        where: { siteId: s.id },
        create: {
          siteId: s.id,
          alarmCodeEnc: encryptString(alarmCode),
          padlockCodeEnc: encryptString(padlockCode),
          entryStepsMd:
            "1. Approach from main gate\n2. Disable alarm within 30s\n3. Lock door behind you",
          lockboxId: `LB-${ri(1000, 9999)}`,
          hazards: pick([null, "Slippery floor near loading bay", "Low ceiling in basement"]),
        },
        update: {},
      });
      accessCount++;
    }
  } else {
    warnings.push(
      "ENCRYPTION_KEY not set — skipped seeding AccessInstruction with alarm/padlock codes.",
    );
  }
  counts.accessInstructions = accessCount;

  // ── Key sets + keys + movements ─────────────────────────────────────────
  let keySetCount = 0;
  let keyCount = 0;
  let keyMoveCount = 0;
  const keyholdingSites = sites.filter((s) => s.spec.services.includes("KEYHOLDING"));
  for (const s of keyholdingSites) {
    const existing = await prisma.keySet.findFirst({
      where: { siteId: s.id, label: { startsWith: "DEMO" } },
      select: { id: true },
    });
    if (existing) continue;
    const set = await prisma.keySet.create({
      data: {
        siteId: s.id,
        internalNo: `DEMO-KS-${s.code}`,
        label: `DEMO Set for ${s.name}`,
        notes: "Main keyset, signed-in at HQ safe",
        active: true,
      },
    });
    keySetCount++;

    const keyCountPerSet = ri(2, 4);
    for (let i = 0; i < keyCountPerSet; i++) {
      const status = pick(["WITH_US", "WITH_US", "WITH_OFFICER"]);
      const holder = status === "WITH_OFFICER" ? pick(officers) : null;
      const key = await prisma.key.create({
        data: {
          siteId: s.id,
          keySetId: set.id,
          internalNo: `DEMO-K-${s.code}-${i + 1}`,
          label: pick(["Front door", "Roller shutter", "Side gate", "Office", "Padlock"]),
          type: pick(["KEY", "KEY", "FOB", "PADLOCK"]) as any,
          status: status as any,
          currentHolderUserId: holder?.id ?? null,
          duplicable: rng() > 0.5,
        },
      });
      keyCount++;

      // Movement history for WITH_OFFICER keys.
      if (holder) {
        await prisma.keyMovement.create({
          data: {
            keyId: key.id,
            fromUserId: null,
            toUserId: holder.id,
            occurredAt: daysFrom(-ri(1, 14), ri(8, 18)),
            reason: pick(["Site visit", "Alarm response", "Scheduled patrol"]),
            signedOffById: pick(officers).id,
          },
        });
        keyMoveCount++;
      }
    }
  }
  counts.keySets = keySetCount;
  counts.keys = keyCount;
  counts.keyMovements = keyMoveCount;

  // ── Patrol schedules ────────────────────────────────────────────────────
  const days: ("MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN")[] = [
    "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
  ];
  let patrolSchedCount = 0;
  const patrolSites = sites.filter(
    (s) => s.spec.services.includes("PATROL") || s.spec.services.includes("VPI"),
  );
  const patrolSchedules: { id: string; siteId: string; kind: string }[] = [];
  for (const s of patrolSites) {
    const kindOptions = [
      ...(s.spec.services.includes("PATROL") ? ["PATROL" as const] : []),
      ...(s.spec.services.includes("VPI") ? ["VPI" as const] : []),
    ];
    for (const kind of kindOptions) {
      const dayCount = ri(1, 3);
      const chosenDays = pickSome(days, dayCount);
      for (const d of chosenDays) {
        const officer = rng() > 0.3 ? pick(officers) : null;
        const sched = await prisma.patrolSchedule.create({
          data: {
            siteId: s.id,
            kind,
            dayOfWeek: d,
            frequency: pick(["WEEKLY", "WEEKLY", "FORTNIGHTLY"]) as any,
            assignedOfficerId: officer?.id ?? null,
            active: true,
          },
          select: { id: true, siteId: true, kind: true },
        });
        patrolSchedules.push(sched);
        patrolSchedCount++;
      }
    }
  }
  counts.patrolSchedules = patrolSchedCount;

  // ── Lock/unlock schedules ───────────────────────────────────────────────
  let lockSchedCount = 0;
  const lockSites = sites.filter(
    (s) => s.spec.services.includes("LOCKUP") || s.spec.services.includes("UNLOCK"),
  );
  for (const s of lockSites) {
    const existing = await prisma.lockUnlockSchedule.findFirst({
      where: { siteId: s.id },
      select: { id: true },
    });
    if (existing) continue;
    const officer = rng() > 0.2 ? pick(officers) : null;
    await prisma.lockUnlockSchedule.create({
      data: {
        siteId: s.id,
        days: pickSome(days, ri(3, 6)) as any,
        unlockTime: s.spec.services.includes("UNLOCK") ? `0${ri(6, 9)}:00`.slice(-5) : null,
        lockdownTime: s.spec.services.includes("LOCKUP") ? `${ri(18, 22)}:30` : null,
        assignedOfficerId: officer?.id ?? null,
        active: true,
      },
    });
    lockSchedCount++;
  }
  counts.lockUnlockSchedules = lockSchedCount;

  // ── Patrol visits (past completed, present, future pending) ────────────
  let visitCount = 0;
  const visitsBuffer: { id: string; siteId: string; officerId: string | null; status: string }[] = [];

  for (const sched of patrolSchedules) {
    // Past completed visits (10 over the last 30 days for each schedule)
    for (let i = 0; i < 8; i++) {
      const daysAgo = ri(1, 30);
      const arrived = daysFrom(-daysAgo, ri(7, 21), ri(0, 59));
      const departed = new Date(arrived.getTime() + ri(15, 55) * 60_000);
      const billed = ri(35, 65);
      const officer = pick(officers);
      const v = await prisma.patrolVisit.create({
        data: {
          siteId: sched.siteId,
          patrolScheduleId: sched.id,
          officerId: officer.id,
          scheduledAt: arrived,
          arrivedAt: arrived,
          departedAt: departed,
          status: "COMPLETED",
          billedAmount: billed,
          billedCurrency: "GBP",
          billedAt: departed,
          paidAmount: Math.round(billed * 0.6),
          paidCurrency: "GBP",
          paidAt: departed,
          payRateUnit: "PER_VISIT",
          gpsLat: 51 + rng() * 2,
          gpsLng: -2 + rng() * 4,
          photoUrls: [],
        },
        select: { id: true },
      });
      visitsBuffer.push({ id: v.id, siteId: sched.siteId, officerId: officer.id, status: "COMPLETED" });
      visitCount++;
    }
    // A couple of future PENDING
    for (let i = 0; i < 2; i++) {
      await prisma.patrolVisit.create({
        data: {
          siteId: sched.siteId,
          patrolScheduleId: sched.id,
          officerId: rng() > 0.3 ? pick(officers).id : null,
          scheduledAt: daysFrom(ri(1, 10), ri(8, 20)),
          status: "PENDING",
        },
      });
      visitCount++;
    }
  }

  // A couple of MISSED and LATE for visibility
  for (let i = 0; i < 3; i++) {
    const sched = pick(patrolSchedules);
    await prisma.patrolVisit.create({
      data: {
        siteId: sched.siteId,
        patrolScheduleId: sched.id,
        officerId: pick(officers).id,
        scheduledAt: daysFrom(-ri(1, 5), ri(8, 18)),
        status: i === 0 ? ("LATE" as any) : ("MISSED" as any),
      },
    });
    visitCount++;
  }
  counts.patrolVisits = visitCount;

  // ── Alarm events ────────────────────────────────────────────────────────
  let alarmCount = 0;
  const alarmEvents: { id: string; siteId: string; assignedTo: string | null }[] = [];
  const alarmSites = sites.filter((s) => s.spec.services.includes("ALARM_RESPONSE"));
  for (let i = 0; i < 15; i++) {
    const s = pick(alarmSites);
    const isPast = i < 10;
    const officer = pick(officers);
    const a = await prisma.alarmEvent.create({
      data: {
        siteId: s.id,
        source: pick(["ARC_EMAIL", "PARTNER_EMAIL", "PARTNER_PHONE", "MANUAL"]) as any,
        receivedAt: daysFrom(-ri(0, 20), ri(0, 23), ri(0, 59)),
        rawSubject: `Zone ${ri(1, 8)} activation at ${s.name}`,
        rawBody: "Demo alarm event for testing.",
        zone: `Z${ri(1, 8)}`,
        priority: pick(["MEDIUM", "MEDIUM", "HIGH", "LOW"]) as any,
        assignedToId: rng() > 0.3 ? officer.id : null,
        outcome: isPast
          ? (pick(["FALSE_ALARM", "FALSE_ALARM", "GENUINE", "RESOLVED"]) as any)
          : null,
        closedAt: isPast ? daysFrom(-ri(0, 20), ri(0, 23)) : null,
        notes: isPast ? "Resolved on site." : null,
      },
      select: { id: true, siteId: true, assignedToId: true },
    });
    alarmEvents.push({ id: a.id, siteId: a.siteId, assignedTo: a.assignedToId });
    alarmCount++;
  }
  counts.alarmEvents = alarmCount;

  // ── Jobs ────────────────────────────────────────────────────────────────
  let jobCount = 0;
  const jobsBuffer: { id: string; status: string; type: string }[] = [];

  // 6 completed jobs from past alarms
  const closedAlarms = alarmEvents.filter((_, i) => i < 6);
  for (const a of closedAlarms) {
    const site = sites.find((s) => s.id === a.siteId)!;
    const officer = pick(officers);
    const completedAt = daysFrom(-ri(1, 15), ri(0, 23));
    const j = await prisma.job.create({
      data: {
        type: "ALARM_RESPONSE",
        source: "ALARM",
        status: "APPROVED",
        priority: "MEDIUM",
        siteId: site.id,
        customerId: site.spec.customerIdx != null ? customers[site.spec.customerIdx].id : null,
        partnerId: site.spec.partnerIdx != null ? partners[site.spec.partnerIdx].id : null,
        assignedToUserId: officer.id,
        responderType: "INTERNAL_OFFICER",
        alarmEventId: a.id,
        scheduledFor: new Date(completedAt.getTime() - 60 * 60_000),
        startedAt: new Date(completedAt.getTime() - 45 * 60_000),
        completedAt,
        billedAmount: ri(70, 100),
        billedCurrency: "GBP",
        billedAt: completedAt,
        paidAmount: ri(40, 60),
        paidCurrency: "GBP",
        paidAt: completedAt,
        payRateUnit: "PER_VISIT",
      },
    });
    jobsBuffer.push({ id: j.id, status: "APPROVED", type: "ALARM_RESPONSE" });
    jobCount++;
  }

  // 5 scheduled lockup/unlock jobs for tomorrow
  const lockUnlockJobSites = sites.filter(
    (s) => s.spec.services.includes("LOCKUP") || s.spec.services.includes("UNLOCK"),
  );
  for (let i = 0; i < 5; i++) {
    const s = pick(lockUnlockJobSites);
    const type = pick(["LOCK", "UNLOCK"]);
    const j = await prisma.job.create({
      data: {
        type: type as any,
        source: "SCHEDULED",
        status: "ASSIGNED",
        priority: "MEDIUM",
        siteId: s.id,
        customerId: s.spec.customerIdx != null ? customers[s.spec.customerIdx].id : null,
        partnerId: s.spec.partnerIdx != null ? partners[s.spec.partnerIdx].id : null,
        assignedToUserId: pick(officers).id,
        responderType: "INTERNAL_OFFICER",
        scheduledFor: daysFrom(1, type === "LOCK" ? 20 : 7, 0),
        billedAmount: ri(20, 35),
        billedCurrency: "GBP",
        billedAt: new Date(),
        paidAmount: ri(12, 20),
        paidCurrency: "GBP",
        paidAt: new Date(),
        payRateUnit: "PER_VISIT",
      },
    });
    jobsBuffer.push({ id: j.id, status: "ASSIGNED", type });
    jobCount++;
  }

  // 4 in-progress jobs (today)
  for (let i = 0; i < 4; i++) {
    const s = pick(sites);
    const j = await prisma.job.create({
      data: {
        type: pick(["ALARM_RESPONSE", "LOCK", "UNLOCK", "ADHOC"]) as any,
        source: pick(["ALARM", "PARTNER_REQUEST", "AD_HOC"]) as any,
        status: "IN_PROGRESS",
        priority: pick(["MEDIUM", "HIGH"]) as any,
        siteId: s.id,
        customerId: s.spec.customerIdx != null ? customers[s.spec.customerIdx].id : null,
        partnerId: s.spec.partnerIdx != null ? partners[s.spec.partnerIdx].id : null,
        assignedToUserId: pick(officers).id,
        responderType: "INTERNAL_OFFICER",
        scheduledFor: hoursFrom(-2),
        startedAt: hoursFrom(-1),
      },
    });
    jobsBuffer.push({ id: j.id, status: "IN_PROGRESS", type: "ADHOC" });
    jobCount++;
  }

  // 3 open / unassigned ad-hoc jobs
  for (let i = 0; i < 3; i++) {
    const s = pick(sites);
    const j = await prisma.job.create({
      data: {
        type: "ADHOC",
        source: pick(["PARTNER_REQUEST", "CUSTOMER_REQUEST"]) as any,
        status: "OPEN",
        priority: pick(["LOW", "MEDIUM"]) as any,
        siteId: s.id,
        customerId: s.spec.customerIdx != null ? customers[s.spec.customerIdx].id : null,
        partnerId: s.spec.partnerIdx != null ? partners[s.spec.partnerIdx].id : null,
        responderType: "INTERNAL_OFFICER",
        scheduledFor: daysFrom(ri(0, 3), ri(8, 20)),
        notes: "Demo open job awaiting assignment.",
      },
    });
    jobsBuffer.push({ id: j.id, status: "OPEN", type: "ADHOC" });
    jobCount++;
  }

  // 2 submitted jobs (officer done, admin needs to review)
  for (let i = 0; i < 2; i++) {
    const s = pick(sites);
    const completedAt = hoursFrom(-ri(2, 10));
    const j = await prisma.job.create({
      data: {
        type: pick(["ALARM_RESPONSE", "PATROL"]) as any,
        source: "ALARM",
        status: "SUBMITTED",
        priority: "MEDIUM",
        siteId: s.id,
        customerId: s.spec.customerIdx != null ? customers[s.spec.customerIdx].id : null,
        partnerId: s.spec.partnerIdx != null ? partners[s.spec.partnerIdx].id : null,
        assignedToUserId: pick(officers).id,
        responderType: "INTERNAL_OFFICER",
        scheduledFor: hoursFrom(-12),
        startedAt: hoursFrom(-3),
        completedAt,
        billedAmount: ri(70, 100),
        billedCurrency: "GBP",
        billedAt: completedAt,
        paidAmount: ri(40, 60),
        paidCurrency: "GBP",
        paidAt: completedAt,
      },
    });
    jobsBuffer.push({ id: j.id, status: "SUBMITTED", type: "ALARM_RESPONSE" });
    jobCount++;
  }

  // 2 cancelled jobs with audit fields
  for (let i = 0; i < 2; i++) {
    const s = pick(sites);
    await prisma.job.create({
      data: {
        type: "ADHOC",
        source: "AD_HOC",
        status: "CANCELLED",
        priority: "LOW",
        siteId: s.id,
        customerId: s.spec.customerIdx != null ? customers[s.spec.customerIdx].id : null,
        partnerId: s.spec.partnerIdx != null ? partners[s.spec.partnerIdx].id : null,
        responderType: "INTERNAL_OFFICER",
        scheduledFor: daysFrom(-ri(1, 7)),
        cancelledAt: daysFrom(-ri(0, 5)),
        cancelledByUserId: users.find((u) => u.role === "DISPATCHER")?.id ?? null,
        notes: "Demo cancelled job — duplicate of another booking.",
      },
    });
    jobCount++;
  }
  counts.jobs = jobCount;

  // ── Shifts ──────────────────────────────────────────────────────────────
  let shiftCount = 0;
  const shiftSites = sites.filter((s) =>
    s.spec.services.includes("STATIC_GUARDING") || s.spec.services.includes("DOG_HANDLER"),
  );
  if (shiftSites.length === 0) shiftSites.push(...sites.slice(0, 3));

  // 2 in-progress (today)
  for (let i = 0; i < 2; i++) {
    const s = pick(shiftSites);
    await prisma.shift.create({
      data: {
        siteId: s.id,
        officerId: pick(officers).id,
        type: pick(["STATIC_GUARDING", "DOG_HANDLER"]) as any,
        scheduledStartsAt: hoursFrom(-3),
        scheduledEndsAt: hoursFrom(5),
        actualStartedAt: hoursFrom(-3),
        status: "IN_PROGRESS",
        checkIntervalMin: 60,
        graceMinutes: 15,
        notes: "Demo in-progress shift",
      },
    });
    shiftCount++;
  }

  // 4 completed (past)
  for (let i = 0; i < 4; i++) {
    const s = pick(shiftSites);
    const start = daysFrom(-ri(1, 14), ri(18, 22));
    const end = new Date(start.getTime() + ri(6, 10) * 3600_000);
    await prisma.shift.create({
      data: {
        siteId: s.id,
        officerId: pick(officers).id,
        type: pick(["STATIC_GUARDING", "DOG_HANDLER"]) as any,
        scheduledStartsAt: start,
        scheduledEndsAt: end,
        actualStartedAt: new Date(start.getTime() + ri(-5, 5) * 60_000),
        actualEndedAt: new Date(end.getTime() + ri(-15, 15) * 60_000),
        status: "COMPLETED",
        checkIntervalMin: 60,
        graceMinutes: 15,
      },
    });
    shiftCount++;
  }

  // 3 pending future
  for (let i = 0; i < 3; i++) {
    const s = pick(shiftSites);
    const start = daysFrom(ri(1, 7), ri(18, 22));
    const end = new Date(start.getTime() + 8 * 3600_000);
    await prisma.shift.create({
      data: {
        siteId: s.id,
        officerId: rng() > 0.3 ? pick(officers).id : null,
        type: pick(["STATIC_GUARDING", "DOG_HANDLER"]) as any,
        scheduledStartsAt: start,
        scheduledEndsAt: end,
        status: "PENDING",
        checkIntervalMin: 60,
        graceMinutes: 15,
      },
    });
    shiftCount++;
  }

  // 1 missed
  const missedStart = daysFrom(-2, 22);
  await prisma.shift.create({
    data: {
      siteId: pick(shiftSites).id,
      officerId: pick(officers).id,
      type: "STATIC_GUARDING",
      scheduledStartsAt: missedStart,
      scheduledEndsAt: new Date(missedStart.getTime() + 8 * 3600_000),
      status: "MISSED",
      checkIntervalMin: 60,
      graceMinutes: 15,
    },
  });
  shiftCount++;
  counts.shifts = shiftCount;

  // ── Form blueprints + templates ─────────────────────────────────────────
  const bp1 = await prisma.formBlueprint.upsert({
    where: { slug: "DEMO-alarm-response" },
    create: {
      slug: "DEMO-alarm-response",
      name: "DEMO Alarm Response",
      description: "Demo blueprint for alarm-response submissions.",
      jobType: "ALARM_RESPONSE",
      fields: [
        { key: "zone", label: "Zone", type: "text", required: true },
        { key: "cause", label: "Probable cause", type: "select", options: ["Wind", "Animal", "Genuine", "Unknown"] },
        { key: "notes", label: "Officer notes", type: "textarea" },
      ] as any,
      builtin: false,
      active: true,
    },
    update: {},
  });
  const bp2 = await prisma.formBlueprint.upsert({
    where: { slug: "DEMO-patrol" },
    create: {
      slug: "DEMO-patrol",
      name: "DEMO Patrol Visit",
      description: "Demo blueprint for patrol visits.",
      jobType: "PATROL",
      fields: [
        { key: "issues", label: "Issues spotted", type: "textarea" },
        { key: "photos", label: "Photo URLs", type: "text" },
      ] as any,
      builtin: false,
      active: true,
    },
    update: {},
  });
  counts.formBlueprints = 2;

  let templateCount = 0;
  for (const c of customers.slice(0, 2)) {
    await prisma.formTemplate.upsert({
      where: {
        // No native unique on (scope, name), so we look up first and create
        id:
          (
            await prisma.formTemplate.findFirst({
              where: { customerId: c.id, name: `DEMO ${c.name} Alarm Response` },
              select: { id: true },
            })
          )?.id ?? "00000000-0000-0000-0000-000000000000",
      },
      create: {
        name: `DEMO ${c.name} Alarm Response`,
        jobType: "ALARM_RESPONSE",
        scope: "CUSTOMER" as any,
        customerId: c.id,
        blueprintId: bp1.id,
        fields: (bp1.fields as any),
        active: true,
      },
      update: {},
    });
    templateCount++;
  }
  counts.formTemplates = templateCount;

  // ── Form submissions (for completed visits + jobs) ──────────────────────
  let subCount = 0;
  const completedVisits = visitsBuffer.filter((v) => v.status === "COMPLETED").slice(0, 12);
  for (const v of completedVisits) {
    const officer = users.find((u) => u.id === v.officerId);
    await prisma.formSubmission.create({
      data: {
        form: "PATROL" as any,
        siteId: v.siteId,
        patrolVisitId: v.id,
        submittedByUserId: officer?.id ?? null,
        officerNameRaw: officer?.name ?? "DEMO Unknown officer",
        arrivedAt: hoursFrom(-ri(2, 24)),
        departedAt: hoursFrom(-ri(1, 23)),
        payload: { issues: "Demo: all clear", photos: "" } as any,
      },
    });
    subCount++;
  }
  const submittedJobs = jobsBuffer.filter((j) => j.status === "SUBMITTED" || j.status === "APPROVED");
  for (const j of submittedJobs) {
    await prisma.formSubmission.create({
      data: {
        form: "ALARM_RESPONSE" as any,
        jobId: j.id,
        submittedByUserId: pick(officers).id,
        officerNameRaw: pick(officers).name,
        arrivedAt: hoursFrom(-ri(2, 12)),
        departedAt: hoursFrom(-ri(1, 11)),
        payload: { zone: `Z${ri(1, 8)}`, cause: "Wind", notes: "Demo: false alarm" } as any,
      },
    });
    subCount++;
  }
  counts.formSubmissions = subCount;

  // ── Report reviews (some pending, some approved) ────────────────────────
  let reviewCount = 0;
  const recentSubs = await prisma.formSubmission.findMany({
    where: { officerNameRaw: { startsWith: "DEMO" } },
    orderBy: { submittedAt: "desc" },
    take: 8,
    select: { id: true },
  });
  for (let i = 0; i < recentSubs.length; i++) {
    const status: "PENDING" | "APPROVED" | "REJECTED" =
      i < 3 ? "PENDING" : i < 7 ? "APPROVED" : "REJECTED";
    const reviewer = users.find((u) => u.role === "DISPATCHER");
    await prisma.reportReview.upsert({
      where: { submissionId: recentSubs[i].id },
      create: {
        submissionId: recentSubs[i].id,
        status: status as any,
        reviewerId: status !== "PENDING" ? reviewer?.id ?? null : null,
        reviewedAt: status !== "PENDING" ? hoursFrom(-ri(1, 24)) : null,
        reviewerNotes: status === "REJECTED" ? "Demo: please re-attend." : null,
      },
      update: {},
    });
    reviewCount++;
  }
  counts.reportReviews = reviewCount;

  // ── Client reports (a few sent) ─────────────────────────────────────────
  let reportCount = 0;
  const approvedReviews = await prisma.reportReview.findMany({
    where: { status: "APPROVED" as any, submission: { officerNameRaw: { startsWith: "DEMO" } } },
    take: 4,
    select: { id: true },
  });
  for (const r of approvedReviews) {
    await prisma.clientReport.create({
      data: {
        reviewId: r.id,
        channel: "EMAIL",
        toAddress: "demo+reports@demo.example",
        subject: "Daily attendance report — DEMO",
        status: pick(["SENT", "SENT", "PENDING"]) as any,
        sentAt: hoursFrom(-ri(1, 48)),
      },
    });
    reportCount++;
  }
  counts.clientReports = reportCount;

  // ── Onboarding pipelines ────────────────────────────────────────────────
  let pipeCount = 0;
  const onboardingSites = sites.slice(-3); // last 3 sites get pipelines
  const stages: ("PROPOSED" | "SURVEY" | "KEY_COLLECTION" | "GO_LIVE")[] = [
    "PROPOSED", "SURVEY", "KEY_COLLECTION", "GO_LIVE",
  ];
  for (let i = 0; i < onboardingSites.length; i++) {
    await prisma.onboardingPipeline.create({
      data: {
        siteId: onboardingSites[i].id,
        program: pick(["SHURGARD", "OTHER"]) as any,
        stage: stages[i % stages.length] as any,
        targetGoLiveDate: daysFrom(ri(7, 45)),
        notes: "Demo onboarding pipeline.",
      },
    });
    pipeCount++;
  }
  counts.onboardingPipelines = pipeCount;

  // ── Notifications (mixed statuses) ──────────────────────────────────────
  let notifCount = 0;
  for (let i = 0; i < 8; i++) {
    const status: "PENDING" | "SENT" | "FAILED" = i < 3 ? "PENDING" : i < 7 ? "SENT" : "FAILED";
    await prisma.notification.create({
      data: {
        channel: "WHATSAPP",
        kind: pick([
          "VISIT_STARTED",
          "SHIFT_CHECK_OVERDUE",
          "VISIT_COMPLETED",
          "ALARM_RECEIVED",
          "KEY_HANDOVER",
        ]) as any,
        recipientUserId: pick(officers).id,
        recipientNumber: `+44770090${ri(1000, 9999)}`,
        templateName: "demo_template",
        templateParams: ["Officer", "Site"] as any,
        bodyPreview: "DEMO notification preview text",
        status: status as any,
        attempts: status === "FAILED" ? ri(2, 5) : status === "SENT" ? 1 : 0,
        error: status === "FAILED" ? "Demo: WhatsApp window expired" : null,
        sentAt: status === "SENT" ? hoursFrom(-ri(1, 48)) : null,
      },
    });
    notifCount++;
  }
  counts.notifications = notifCount;

  return {
    ok: true,
    message: opts.reset
      ? "Demo data reset and reseeded."
      : "Demo data seeded.",
    counts,
    warnings,
  };
}

/**
 * Delete every row that looks like demo data, in dependency-safe order.
 * Returns the total number of rows deleted (approximate — counts the
 * top-level deletes; cascades are not counted).
 */
async function resetDemo(): Promise<number> {
  let total = 0;

  // Notifications (FK on User SetNull, so safe in any order)
  total += (await prisma.notification.deleteMany({
    where: { bodyPreview: { startsWith: "DEMO" } },
  })).count;

  // Client reports + reviews — chained through submissions with DEMO names
  const demoSubmissionIds = await prisma.formSubmission.findMany({
    where: { officerNameRaw: { startsWith: "DEMO" } },
    select: { id: true },
  });
  const demoSubIdSet = demoSubmissionIds.map((s) => s.id);
  if (demoSubIdSet.length > 0) {
    const demoReviewIds = await prisma.reportReview.findMany({
      where: { submissionId: { in: demoSubIdSet } },
      select: { id: true },
    });
    if (demoReviewIds.length > 0) {
      total += (await prisma.clientReport.deleteMany({
        where: { reviewId: { in: demoReviewIds.map((r) => r.id) } },
      })).count;
      total += (await prisma.reportReview.deleteMany({
        where: { id: { in: demoReviewIds.map((r) => r.id) } },
      })).count;
    }
    total += (await prisma.formSubmission.deleteMany({
      where: { id: { in: demoSubIdSet } },
    })).count;
  }

  // Form templates + blueprints
  total += (await prisma.formTemplate.deleteMany({
    where: { name: { startsWith: "DEMO" } },
  })).count;
  total += (await prisma.formBlueprint.deleteMany({
    where: { slug: { startsWith: "DEMO-" } },
  })).count;

  // Sites cascade-delete most child tables (KeySet, AccessInstruction,
  // PatrolSchedule, LockUnlockSchedule, OnboardingPipeline, SiteRate).
  // We need to manually clear non-cascading children first: Job,
  // PatrolVisit, Shift, AlarmEvent.
  const demoSiteIds = (
    await prisma.site.findMany({
      where: { code: { startsWith: DEMO_PREFIX } },
      select: { id: true },
    })
  ).map((s) => s.id);

  if (demoSiteIds.length > 0) {
    total += (await prisma.job.deleteMany({
      where: { siteId: { in: demoSiteIds } },
    })).count;
    total += (await prisma.patrolVisit.deleteMany({
      where: { siteId: { in: demoSiteIds } },
    })).count;
    total += (await prisma.shift.deleteMany({
      where: { siteId: { in: demoSiteIds } },
    })).count;
    total += (await prisma.alarmEvent.deleteMany({
      where: { siteId: { in: demoSiteIds } },
    })).count;
    total += (await prisma.site.deleteMany({
      where: { id: { in: demoSiteIds } },
    })).count;
  }

  // Officer rates (only for demo users — by email prefix)
  const demoUserIds = (
    await prisma.user.findMany({
      where: { email: { startsWith: "demo+" } },
      select: { id: true },
    })
  ).map((u) => u.id);
  if (demoUserIds.length > 0) {
    total += (await prisma.officerRate.deleteMany({
      where: { officerId: { in: demoUserIds } },
    })).count;
    total += (await prisma.user.deleteMany({
      where: { id: { in: demoUserIds } },
    })).count;
  }

  // Customers + Partners (their contacts cascade)
  total += (await prisma.customer.deleteMany({
    where: { name: { startsWith: "DEMO " } },
  })).count;
  total += (await prisma.partner.deleteMany({
    where: { name: { startsWith: "DEMO " } },
  })).count;

  // Regions
  total += (await prisma.region.deleteMany({
    where: { name: { startsWith: "DEMO " } },
  })).count;

  return total;
}
