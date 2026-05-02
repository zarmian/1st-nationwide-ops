/**
 * Nexus CSV importer.
 *
 *   npm run db:import:nexus -- /absolute/path/to/nexus_sites.csv
 *
 * Idempotent: re-running with an updated CSV upserts sites by their Nexus
 * Reference (e.g. "SITE-113341") and replaces all SiteRate rows for the site.
 *
 * Required env: DATABASE_URL, DIRECT_URL
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

const PARTNER_NAME = "Nexus Security";

// CSV header → service mapping. Columns absent from this map become Site
// metadata or are ignored.
const RATE_COLUMNS: Array<{
  column: string;
  service:
    | "ADHOC"
    | "ANNUAL_SUBSCRIPTION"
    | "STATIC_GUARDING"
    | "LOCKUP"
    | "PATROL"
    | "ALARM_RESPONSE"
    | "SITE_SETUP"
    | "UNLOCK"
    | "VPI";
  unit: "PER_VISIT" | "PER_HOUR" | "PER_YEAR" | "FIXED";
}> = [
  { column: "AdHoc Rate", service: "ADHOC", unit: "PER_VISIT" },
  { column: "Annual Subscription", service: "ANNUAL_SUBSCRIPTION", unit: "PER_YEAR" },
  { column: "Guarding", service: "STATIC_GUARDING", unit: "PER_HOUR" },
  { column: "Lock Rate", service: "LOCKUP", unit: "PER_VISIT" },
  { column: "Patrol Rate", service: "PATROL", unit: "PER_VISIT" },
  { column: "Response Rate", service: "ALARM_RESPONSE", unit: "PER_VISIT" },
  { column: "Site Setup", service: "SITE_SETUP", unit: "FIXED" },
  { column: "Unlock Rate", service: "UNLOCK", unit: "PER_VISIT" },
  { column: "VPI", service: "VPI", unit: "PER_VISIT" },
];

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

function readCsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) throw new Error(`CSV not found: ${path}`);
  // Tolerate the BOM many Windows exports add at the start of the file.
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
  // Lines may use \r\n, \n, or even contain quoted newlines — for the Nexus
  // export we've seen these are flat one-row-per-line, so a simple split is
  // fine. Revisit if a quoted newline ever shows up.
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseRow(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    return Object.fromEntries(
      headers.map((h, i) => [h, (cells[i] ?? "").trim()]),
    );
  });
}

const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;

function normalisePostcode(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(pc: string): string {
  const n = normalisePostcode(pc);
  if (n.length < 5) return pc.toUpperCase();
  return `${n.slice(0, n.length - 3)} ${n.slice(-3)}`;
}

/**
 * Best-effort UK address parser. Strips a UK postcode at the end, takes the
 * last comma-separated chunk as the city, joins the rest as address line.
 * Returns null fields when nothing parses (caller decides what to do).
 */
function parseAddress(addr: string): {
  addressLine: string;
  city: string | null;
  postcodeRaw: string | null;
} {
  const trimmed = addr.trim();
  const pcMatch = trimmed.match(POSTCODE_RE);
  if (!pcMatch) {
    return { addressLine: trimmed, city: null, postcodeRaw: null };
  }
  const postcodeRaw = `${pcMatch[1]} ${pcMatch[2]}`;
  // Strip from the postcode onwards (and any trailing comma/whitespace).
  const before = trimmed.slice(0, pcMatch.index!).replace(/[,\s]+$/, "");
  const parts = before.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { addressLine: trimmed, city: null, postcodeRaw };
  }
  // London is sometimes repeated as the last two chunks ("…, London, London,
  // SE27 9BQ"). Collapse trailing duplicates so the city is just the city.
  while (parts.length > 1 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.pop();
  }
  const city = parts.length > 1 ? parts[parts.length - 1] : null;
  const addressLineParts = city ? parts.slice(0, -1) : parts;
  return {
    addressLine: addressLineParts.join(", "),
    city,
    postcodeRaw,
  };
}

function parseDateUK(s: string): Date | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function parseBool(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "yes" || t === "true" || t === "y" || t === "1";
}

function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: npm run db:import:nexus -- /absolute/path/to/nexus_sites.csv",
    );
    process.exit(2);
  }
  const absPath = resolve(path);
  console.log(`Importing Nexus sites from ${absPath}`);

  const partner = await prisma.partner.findUnique({
    where: { name: PARTNER_NAME },
    select: { id: true },
  });
  if (!partner) {
    console.error(
      `Partner "${PARTNER_NAME}" not found. Run \`npm run db:seed\` first.`,
    );
    process.exit(2);
  }

  const rows = readCsv(absPath);
  console.log(`Read ${rows.length} rows`);

  let sitesUpserted = 0;
  let sitesSkipped = 0;
  let ratesWritten = 0;
  const ratesSource = `Nexus CSV ${new Date().toISOString().slice(0, 10)}`;

  for (const row of rows) {
    const reference = (row["Reference"] ?? "").trim();
    if (!reference) {
      sitesSkipped++;
      continue;
    }

    const name = (row["Site Name"] ?? "").trim() || reference;
    const addrRaw = (row["Site Address"] ?? "").trim();
    const parsed = parseAddress(addrRaw);
    if (!parsed.postcodeRaw) {
      console.warn(
        `  ! ${reference} — no postcode parsed from "${addrRaw}". Skipping.`,
      );
      sitesSkipped++;
      continue;
    }
    const postcode = normalisePostcode(parsed.postcodeRaw);
    const postcodeFormatted = formatPostcode(parsed.postcodeRaw);

    const partnerStatus = (row["Site Status"] ?? "").trim() || null;
    const dne = parseBool(row["DNE"] ?? "");
    const hsMarkers = parseBool(row["HS Markers"] ?? "");
    const startDate = parseDateUK(row["Site Start Date"] ?? "");
    const terminationDate = parseDateUK(row["Site Termination Date"] ?? "");
    const active =
      partnerStatus == null
        ? true
        : partnerStatus.toLowerCase() === "active";

    // Match an existing site by partnerReference first, then fall back to
    // (postcode + name) to catch pre-existing rows from earlier imports.
    let existing = await prisma.site.findFirst({
      where: { partnerReference: reference },
      select: { id: true },
    });
    if (!existing) {
      existing = await prisma.site.findFirst({
        where: { postcode, name },
        select: { id: true },
      });
    }

    const baseData = {
      name,
      addressLine: parsed.addressLine || addrRaw,
      city: parsed.city,
      postcode,
      postcodeFormatted,
      partnerId: partner.id,
      partnerReference: reference,
      partnerSin: (row["Site SIN"] ?? "").trim() || null,
      sapRef: (row["Site SAP"] ?? "").trim() || null,
      opsUnit: (row["Site OPS Unit"] ?? "").trim() || null,
      what3words: (row["what3words"] ?? "").trim() || null,
      partnerStatus,
      startDate,
      terminationDate,
      dne,
      hsMarkers,
      active,
    };

    let siteId: string;
    if (existing) {
      const updated = await prisma.site.update({
        where: { id: existing.id },
        data: baseData,
        select: { id: true },
      });
      siteId = updated.id;
    } else {
      const created = await prisma.site.create({
        data: baseData,
        select: { id: true },
      });
      siteId = created.id;
    }
    sitesUpserted++;

    // Refresh rates: replace whatever's there with whatever's in the CSV.
    // Skips zero-valued cells (interpreted as "service not offered here").
    const rateOps: Prisma.PrismaPromise<unknown>[] = [
      prisma.siteRate.deleteMany({ where: { siteId } }),
    ];
    for (const r of RATE_COLUMNS) {
      const amount = parseAmount(row[r.column] ?? "");
      if (amount == null || amount <= 0) continue;
      rateOps.push(
        prisma.siteRate.create({
          data: {
            siteId,
            service: r.service as any,
            amount: new Prisma.Decimal(amount),
            unit: r.unit as any,
            currency: "GBP",
            source: ratesSource,
          },
        }),
      );
      ratesWritten++;
    }
    await prisma.$transaction(rateOps);
  }

  console.log(`\nDone:`);
  console.log(`  ✓ ${sitesUpserted} sites upserted`);
  console.log(`  ✓ ${ratesWritten} rate rows written`);
  if (sitesSkipped > 0) {
    console.log(`  ! ${sitesSkipped} rows skipped (no Reference or postcode)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
