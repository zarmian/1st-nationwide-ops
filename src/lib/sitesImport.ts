/**
 * Generic sites CSV importer — parse, preview, and apply.
 *
 * Sister to nexusImport.ts but for arbitrary site lists (Shurgard, Aegis,
 * Orbis, or the historical 485-site export at prisma/seed_data/import_out/
 * sites.csv). Tags rows to a Customer or Partner by:
 *   1. explicit `customer` / `partner` column, if present, OR
 *   2. name-prefix auto-detect (e.g. "Shurgard Aldershot" → Shurgard).
 *
 * Always run preview first — no writes happen until runSitesImport().
 */
import type { PrismaClient, SiteType, ServiceTag } from "@prisma/client";
import {
  readCsvRows,
  normalisePostcode,
  formatPostcode,
} from "./nexusImport";

const SITE_TYPES = new Set<SiteType>([
  "COMMERCIAL",
  "RESIDENTIAL",
  "RETAIL",
  "STORAGE",
  "INDUSTRIAL",
  "OTHER",
]);

const SERVICE_TAGS = new Set<ServiceTag>([
  "ALARM_RESPONSE",
  "KEYHOLDING",
  "LOCKUP",
  "UNLOCK",
  "VPI",
  "PATROL",
  "STATIC_GUARDING",
  "DOG_HANDLER",
  "ADHOC",
]);

// Sites whose name starts with one of these get auto-linked to the matching
// Customer if no `customer` column is provided in the CSV. Lower-cased prefix
// → Customer name lookup.
const CUSTOMER_NAME_PREFIXES: Array<{ prefix: string; customer: string }> = [
  { prefix: "shurgard ", customer: "Shurgard" },
  { prefix: "aegis ", customer: "Aegis" },
  { prefix: "orbis ", customer: "Orbis" },
];

// `code` prefix → Partner name. Nexus sites carry "NEX 001" etc.
const PARTNER_CODE_PREFIXES: Array<{ prefix: string; partner: string }> = [
  { prefix: "NEX", partner: "Nexus Security" },
];

export type SiteImportSkip = {
  rowIndex: number;
  name: string | null;
  reason: string;
};

export type SiteImportAction = "CREATE" | "UPDATE";

export type SitePreviewRow = {
  rowIndex: number;
  action: SiteImportAction;
  code: string | null;
  name: string;
  postcodeFormatted: string;
  region: string | null;
  customer: string | null;
  partner: string | null;
  warnings: string[];
};

export type SitesImportPreview = {
  read: number;
  toCreate: number;
  toUpdate: number;
  byCustomer: Record<string, number>;
  byPartner: Record<string, number>;
  untagged: number;
  skipped: SiteImportSkip[];
  sample: SitePreviewRow[];
};

export type SitesImportResult = {
  created: number;
  updated: number;
  customersLinked: number;
  partnersLinked: number;
  regionsCreated: number;
  skipped: SiteImportSkip[];
};

type ParsedRow = {
  rowIndex: number;
  code: string | null;
  name: string;
  addressLine: string;
  postcode: string;
  postcodeFormatted: string;
  type: SiteType;
  regionName: string | null;
  services: ServiceTag[];
  notes: string | null;
  lat: number | null;
  lng: number | null;
  customerName: string | null;
  partnerName: string | null;
  warnings: string[];
};

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v.trim() !== "") return v.trim();
  }
  return "";
}

function parseFloatOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function autoDetectCustomer(name: string): string | null {
  const lower = name.toLowerCase();
  for (const { prefix, customer } of CUSTOMER_NAME_PREFIXES) {
    if (lower.startsWith(prefix)) return customer;
  }
  return null;
}

function autoDetectPartner(code: string | null): string | null {
  if (!code) return null;
  for (const { prefix, partner } of PARTNER_CODE_PREFIXES) {
    if (code.toUpperCase().startsWith(prefix)) return partner;
  }
  return null;
}

function parseRow(
  raw: Record<string, string>,
  rowIndex: number,
): { ok: true; row: ParsedRow } | { ok: false; skip: SiteImportSkip } {
  const name = pick(raw, ["name", "Name", "Site Name", "site_name"]);
  if (!name) {
    return {
      ok: false,
      skip: { rowIndex, name: null, reason: "no `name` value" },
    };
  }
  const postcodeRaw = pick(raw, [
    "postcode",
    "Postcode",
    "post_code",
    "Site Postcode",
  ]);
  if (!postcodeRaw) {
    return {
      ok: false,
      skip: { rowIndex, name, reason: "no `postcode` value" },
    };
  }

  const code = pick(raw, ["code", "Code", "Reference", "ref"]) || null;
  const addressLineRaw = pick(raw, [
    "addressLine",
    "address_line",
    "address",
    "Address",
    "Site Address",
  ]);
  const typeRaw = pick(raw, ["type", "Type", "Site Type"]).toUpperCase();
  const servicesRaw = pick(raw, ["services", "Services"]);
  const notes = pick(raw, ["notes", "Notes"]) || null;
  const regionName = pick(raw, ["region", "Region"]) || null;
  const customerExplicit = pick(raw, ["customer", "Customer"]) || null;
  const partnerExplicit = pick(raw, ["partner", "Partner"]) || null;
  const latRaw = pick(raw, ["lat", "Lat", "latitude", "Latitude"]);
  const lngRaw = pick(raw, ["lng", "Lng", "longitude", "Longitude", "lon", "Lon"]);

  const warnings: string[] = [];

  // Type: validate, fall back to COMMERCIAL with a warning.
  let type: SiteType = "COMMERCIAL";
  if (typeRaw) {
    if (SITE_TYPES.has(typeRaw as SiteType)) {
      type = typeRaw as SiteType;
    } else {
      warnings.push(`unknown type "${typeRaw}" → COMMERCIAL`);
    }
  }

  // Services: filter to valid enum values, warn on unknowns.
  const services: ServiceTag[] = [];
  if (servicesRaw) {
    for (const raw of servicesRaw.split(/[|,]/)) {
      const s = raw.trim().toUpperCase();
      if (!s) continue;
      if (SERVICE_TAGS.has(s as ServiceTag)) {
        services.push(s as ServiceTag);
      } else {
        warnings.push(`unknown service "${raw.trim()}"`);
      }
    }
  }

  const customerName = customerExplicit ?? autoDetectCustomer(name);
  const partnerName = partnerExplicit ?? autoDetectPartner(code);

  return {
    ok: true,
    row: {
      rowIndex,
      code,
      name,
      addressLine: addressLineRaw || name,
      postcode: normalisePostcode(postcodeRaw),
      postcodeFormatted: formatPostcode(postcodeRaw),
      type,
      regionName,
      services,
      notes,
      lat: parseFloatOrNull(latRaw),
      lng: parseFloatOrNull(lngRaw),
      customerName,
      partnerName,
      warnings,
    },
  };
}

async function loadLookups(prisma: PrismaClient) {
  const [customers, partners, regions] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, name: true } }),
    prisma.partner.findMany({ select: { id: true, name: true } }),
    prisma.region.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    customerByName: new Map(customers.map((c) => [c.name.toLowerCase(), c.id])),
    partnerByName: new Map(partners.map((p) => [p.name.toLowerCase(), p.id])),
    regionByName: new Map(regions.map((r) => [r.name.toLowerCase(), r.id])),
  };
}

export async function previewSitesImport(
  prisma: PrismaClient,
  csvText: string,
): Promise<SitesImportPreview> {
  const rawRows = readCsvRows(csvText);
  const parsed: ParsedRow[] = [];
  const skipped: SiteImportSkip[] = [];

  rawRows.forEach((r, i) => {
    const out = parseRow(r, i + 2); // +2: 1 for header, 1 for 1-based
    if (out.ok) parsed.push(out.row);
    else skipped.push(out.skip);
  });

  const lookups = await loadLookups(prisma);

  // Decide CREATE vs UPDATE per row, and warn on tag misses.
  const codes = parsed
    .map((p) => p.code)
    .filter((c): c is string => c != null);
  const existingByCode = new Map<string, true>(
    (
      await prisma.site.findMany({
        where: { code: { in: codes } },
        select: { code: true },
      })
    ).map((s) => [s.code as string, true]),
  );

  const byCustomer: Record<string, number> = {};
  const byPartner: Record<string, number> = {};
  let untagged = 0;
  let toCreate = 0;
  let toUpdate = 0;

  const sample: SitePreviewRow[] = [];

  for (const r of parsed) {
    // Resolve tag names against DB (and warn if a typed value doesn't match).
    let resolvedCustomer: string | null = null;
    if (r.customerName) {
      if (lookups.customerByName.has(r.customerName.toLowerCase())) {
        resolvedCustomer = r.customerName;
      } else {
        r.warnings.push(
          `customer "${r.customerName}" not found — site will be left untagged`,
        );
      }
    }
    let resolvedPartner: string | null = null;
    if (r.partnerName) {
      if (lookups.partnerByName.has(r.partnerName.toLowerCase())) {
        resolvedPartner = r.partnerName;
      } else {
        r.warnings.push(
          `partner "${r.partnerName}" not found — site will be left untagged`,
        );
      }
    }

    if (resolvedCustomer) {
      byCustomer[resolvedCustomer] = (byCustomer[resolvedCustomer] ?? 0) + 1;
    } else if (resolvedPartner) {
      byPartner[resolvedPartner] = (byPartner[resolvedPartner] ?? 0) + 1;
    } else {
      untagged++;
    }

    // CREATE vs UPDATE.
    let action: SiteImportAction = "CREATE";
    if (r.code && existingByCode.has(r.code)) {
      action = "UPDATE";
    } else if (!r.code) {
      const hit = await prisma.site.findFirst({
        where: { name: r.name, postcode: r.postcode },
        select: { id: true },
      });
      if (hit) action = "UPDATE";
    }
    if (action === "CREATE") toCreate++;
    else toUpdate++;

    if (sample.length < 25) {
      sample.push({
        rowIndex: r.rowIndex,
        action,
        code: r.code,
        name: r.name,
        postcodeFormatted: r.postcodeFormatted,
        region: r.regionName,
        customer: resolvedCustomer,
        partner: resolvedPartner,
        warnings: r.warnings,
      });
    }
  }

  return {
    read: rawRows.length,
    toCreate,
    toUpdate,
    byCustomer,
    byPartner,
    untagged,
    skipped,
    sample,
  };
}

export async function runSitesImport(
  prisma: PrismaClient,
  csvText: string,
): Promise<SitesImportResult> {
  const rawRows = readCsvRows(csvText);
  const parsed: ParsedRow[] = [];
  const skipped: SiteImportSkip[] = [];
  rawRows.forEach((r, i) => {
    const out = parseRow(r, i + 2);
    if (out.ok) parsed.push(out.row);
    else skipped.push(out.skip);
  });

  const lookups = await loadLookups(prisma);

  // Create any missing regions up front so we can resolve regionId per row
  // without a per-row DB call.
  const wantedRegionNames = new Set(
    parsed.map((p) => p.regionName).filter((n): n is string => !!n),
  );
  let regionsCreated = 0;
  for (const name of wantedRegionNames) {
    if (!lookups.regionByName.has(name.toLowerCase())) {
      const r = await prisma.region.create({ data: { name } });
      lookups.regionByName.set(name.toLowerCase(), r.id);
      regionsCreated++;
    }
  }

  let created = 0;
  let updated = 0;
  let customersLinked = 0;
  let partnersLinked = 0;

  for (const r of parsed) {
    const customerId = r.customerName
      ? lookups.customerByName.get(r.customerName.toLowerCase()) ?? null
      : null;
    const partnerId = r.partnerName
      ? lookups.partnerByName.get(r.partnerName.toLowerCase()) ?? null
      : null;
    const regionId = r.regionName
      ? lookups.regionByName.get(r.regionName.toLowerCase()) ?? null
      : null;

    const data = {
      code: r.code,
      name: r.name,
      addressLine: r.addressLine,
      postcode: r.postcode,
      postcodeFormatted: r.postcodeFormatted,
      type: r.type,
      regionId,
      services: r.services,
      notes: r.notes,
      lat: r.lat,
      lng: r.lng,
      // Don't overwrite an existing tag with null — only set when we have a value.
      ...(customerId ? { customerId } : {}),
      ...(partnerId ? { partnerId } : {}),
      active: true,
    };

    let existingId: string | null = null;
    if (r.code) {
      const hit = await prisma.site.findUnique({
        where: { code: r.code },
        select: { id: true },
      });
      existingId = hit?.id ?? null;
    } else {
      const hit = await prisma.site.findFirst({
        where: { name: r.name, postcode: r.postcode },
        select: { id: true },
      });
      existingId = hit?.id ?? null;
    }

    if (existingId) {
      await prisma.site.update({ where: { id: existingId }, data });
      updated++;
    } else {
      await prisma.site.create({ data });
      created++;
    }

    if (customerId) customersLinked++;
    if (partnerId) partnersLinked++;
  }

  return {
    created,
    updated,
    customersLinked,
    partnersLinked,
    regionsCreated,
    skipped,
  };
}
