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
