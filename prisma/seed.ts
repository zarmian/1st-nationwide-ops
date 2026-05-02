/**
 * Seed script — populates the dev database from the CSVs produced by
 * importer.py.  Reads from ../import_out by default; override with
 *   IMPORT_DIR=/abs/path npm run db:seed
 *
 * Idempotent: re-running upserts existing rows, never duplicates.
 *
 * Required env: DATABASE_URL, DIRECT_URL
 * Optional env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD,
 *               IMPORT_DIR (default ../import_out)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const prisma = new PrismaClient();

const IMPORT_DIR = process.env.IMPORT_DIR
  ? resolve(process.env.IMPORT_DIR)
  : resolve(process.cwd(), "..", "import_out");

// Tiny CSV reader good enough for our generated files.
function readCsv(filename: string): Record<string, string>[] {
  const path = join(IMPORT_DIR, filename);
  if (!existsSync(path)) {
    console.warn(`! Skipping ${filename} — not found at ${path}`);
    return [];
  }
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"') {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

function normalisePostcode(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(pc: string): string {
  // "BR11DD" → "BR1 1DD"
  const n = normalisePostcode(pc);
  if (n.length < 5) return pc.toUpperCase();
  return `${n.slice(0, n.length - 3)} ${n.slice(-3)}`;
}

async function main() {
  console.log(`Seeding from ${IMPORT_DIR}`);

  // ── 1. Admin user ────────────────────────────────────────────────────────
  const adminEmail =
    process.env.SEED_ADMIN_EMAIL ?? "admin@1stnationwidesecurity.co.uk";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Change-me-now-1";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Admin",
      role: "ADMIN",
      passwordHash,
      active: true,
    },
  });
  console.log(`  ✓ admin user: ${adminEmail}`);

  // ── 2. Regions ───────────────────────────────────────────────────────────
  const sitesRows = readCsv("sites.csv");
  const regionNames = new Set(
    sitesRows.map((r) => (r.region || "").trim()).filter(Boolean),
  );
  const regionByName = new Map<string, number>();
  for (const name of regionNames) {
    const r = await prisma.region.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    regionByName.set(name, r.id);
  }
  console.log(`  ✓ ${regionNames.size} regions`);

  // ── 3. Sites ─────────────────────────────────────────────────────────────
  let upserts = 0;
  for (const row of sitesRows) {
    const services = (row.services || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

    const postcodeRaw = row.postcode || "";
    const postcode = normalisePostcode(postcodeRaw);
    const postcodeFormatted = formatPostcode(postcodeRaw);
    const regionId = row.region ? regionByName.get(row.region) ?? null : null;

    const data = {
      code: row.code || null,
      name: row.name,
      addressLine: row.addressLine || row.name,
      postcode,
      postcodeFormatted,
      regionId,
      type: (row.type || "COMMERCIAL") as any,
      services: services as any,
      notes: row.notes || null,
      active: true,
    };

    if (row.code) {
      await prisma.site.upsert({
        where: { code: row.code },
        update: data,
        create: data,
      });
    } else {
      // No natural key — match by name+postcode and update, else create.
      const existing = await prisma.site.findFirst({
        where: { name: row.name, postcode },
        select: { id: true },
      });
      if (existing) {
        await prisma.site.update({ where: { id: existing.id }, data });
      } else {
        await prisma.site.create({ data });
      }
    }
    upserts++;
  }
  console.log(`  ✓ ${upserts} sites`);

  // ── 4. Partners ──────────────────────────────────────────────────────────
  const partners: Array<{
    name: string;
    role: "CUSTOMER" | "SUBCONTRACTOR" | "BOTH";
    preferred: "EMAIL" | "PHONE" | "THEIR_APP" | "WHATSAPP" | "PORTAL";
    notes?: string;
  }> = [
    { name: "Nexus Security", role: "BOTH", preferred: "THEIR_APP", notes: "London alarm activations come to us via their app; Shurgard out-of-London jobs sub'd to them." },
    { name: "Keyholding Company", role: "BOTH", preferred: "THEIR_APP", notes: "On-demand jobs come via their app." },
    { name: "Aegis", role: "CUSTOMER", preferred: "EMAIL" },
    { name: "Orbis", role: "CUSTOMER", preferred: "EMAIL" },
    { name: "Shurgard", role: "CUSTOMER", preferred: "EMAIL", notes: "Daily report email." },
  ];
  for (const p of partners) {
    await prisma.partner.upsert({
      where: { name: p.name },
      update: { role: p.role, preferred: p.preferred, notes: p.notes ?? null },
      create: { name: p.name, role: p.role, preferred: p.preferred, notes: p.notes ?? null },
    });
  }
  console.log(`  ✓ ${partners.length} partners`);

  // ── 5. Direct customers ──────────────────────────────────────────────────
  // Per CLAUDE.md, Shurgard / Aegis / Orbis are direct customers (we get the
  // alarm, our officer attends, we send the daily report). Seed them as
  // Customer rows so site.customerId can be set and customer-scoped form
  // templates resolve correctly.
  const directCustomers = [
    { name: "Shurgard", contactEmail: null, notes: "Direct customer — daily report email." },
    { name: "Aegis", contactEmail: null, notes: "Direct customer." },
    { name: "Orbis", contactEmail: null, notes: "Direct customer." },
  ];
  for (const c of directCustomers) {
    await prisma.customer.upsert({
      where: { name: c.name },
      update: { notes: c.notes },
      create: {
        name: c.name,
        type: "CORPORATE" as any,
        contactEmail: c.contactEmail,
        notes: c.notes,
        active: true,
      },
    });
  }
  console.log(`  ✓ ${directCustomers.length} direct customers`);

  // ── 6. Shurgard mobile patrol form template ─────────────────────────────
  const shurgard = await prisma.customer.findUnique({
    where: { name: "Shurgard" },
    select: { id: true },
  });
  if (shurgard) {
    const TEMPLATE_NAME = "Shurgard activity log / call out / mobile patrol";
    const fields = [
      {
        key: `section_intro_${Date.now().toString(36)}`,
        label: "Section 1",
        type: "section",
        required: false,
      },
      {
        key: "main_gates_secured",
        label: "Main gates and internal doors secured?",
        type: "tri",
        required: true,
      },
      {
        key: "fire_police_called",
        label: "Fire services / police called?",
        type: "tri",
        required: true,
      },
      {
        key: "incident_at",
        label: "Time of incident",
        type: "datetime",
        required: true,
        helpText:
          "When the incident occurred — separate from call-out time and your arrival time.",
      },
      {
        key: "stuck_customer_unit",
        label:
          "Customer name and unit number (only if a customer is stuck on site beyond close hours)",
        type: "text",
        required: false,
        helpText: "Leave blank if not applicable.",
      },
      {
        key: "callout_reason",
        label: "Call-out reason — explain any issues with gates or doors",
        type: "textarea",
        required: true,
      },
      {
        key: "site_location",
        label: "Location / GPS",
        type: "location",
        required: true,
        helpText: "Tap 'Capture location' once you're on site.",
      },
    ];

    const existing = await prisma.formTemplate.findFirst({
      where: {
        name: TEMPLATE_NAME,
        scope: "CUSTOMER",
        customerId: shurgard.id,
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.formTemplate.update({
        where: { id: existing.id },
        data: {
          jobType: null,
          fields: fields as any,
          active: true,
        },
      });
    } else {
      await prisma.formTemplate.create({
        data: {
          name: TEMPLATE_NAME,
          scope: "CUSTOMER",
          customerId: shurgard.id,
          jobType: null,
          fields: fields as any,
          active: true,
        },
      });
    }
    console.log(`  ✓ Shurgard form template`);
  } else {
    console.warn(`  ! Shurgard customer not found — form template skipped`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
