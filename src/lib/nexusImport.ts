/**
 * Nexus CSV import — pure parsing helpers + the upsert routine.
 * Used by both the CLI script (prisma/import_nexus.ts) and the admin upload
 * page (/admin/imports/nexus). Keeps the two paths from drifting.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

export const NEXUS_PARTNER_NAME = "Nexus Security";

export const RATE_COLUMNS: Array<{
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

const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;

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

export function readCsvRows(csvText: string): Record<string, string>[] {
  const raw = csvText.replace(/^﻿/, ""); // strip BOM
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

export function normalisePostcode(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

export function formatPostcode(pc: string): string {
  const n = normalisePostcode(pc);
  if (n.length < 5) return pc.toUpperCase();
  return `${n.slice(0, n.length - 3)} ${n.slice(-3)}`;
}

export function parseAddress(addr: string): {
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
  const before = trimmed.slice(0, pcMatch.index!).replace(/[,\s]+$/, "");
  const parts = before.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { addressLine: trimmed, city: null, postcodeRaw };
  }
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

export function parseDateUK(s: string): Date | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

export function parseBool(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "yes" || t === "true" || t === "y" || t === "1";
}

export function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export type ImportSkip = { reference: string | null; reason: string };

export type ImportSummary = {
  read: number;
  toCreate: number;
  toUpdate: number;
  ratesToWrite: number;
  skipped: ImportSkip[];
};

type RowToImport = {
  reference: string;
  data: {
    name: string;
    addressLine: string;
    city: string | null;
    postcode: string;
    postcodeFormatted: string;
    partnerSin: string | null;
    sapRef: string | null;
    opsUnit: string | null;
    what3words: string | null;
    partnerStatus: string | null;
    startDate: Date | null;
    terminationDate: Date | null;
    dne: boolean;
    hsMarkers: boolean;
    active: boolean;
  };
  rates: Array<{ service: string; amount: number; unit: string }>;
};

function rowToImport(row: Record<string, string>): {
  ok: true;
  row: RowToImport;
} | { ok: false; skip: ImportSkip } {
  const reference = (row["Reference"] ?? "").trim();
  if (!reference) {
    return { ok: false, skip: { reference: null, reason: "no Reference" } };
  }
  const name = (row["Site Name"] ?? "").trim() || reference;
  const addrRaw = (row["Site Address"] ?? "").trim();
  const parsed = parseAddress(addrRaw);
  if (!parsed.postcodeRaw) {
    return {
      ok: false,
      skip: { reference, reason: `no postcode parsed from "${addrRaw}"` },
    };
  }
  const partnerStatus = (row["Site Status"] ?? "").trim() || null;
  const active =
    partnerStatus == null ? true : partnerStatus.toLowerCase() === "active";

  const rates: Array<{ service: string; amount: number; unit: string }> = [];
  for (const r of RATE_COLUMNS) {
    const amount = parseAmount(row[r.column] ?? "");
    if (amount == null || amount <= 0) continue;
    rates.push({ service: r.service, amount, unit: r.unit });
  }

  return {
    ok: true,
    row: {
      reference,
      data: {
        name,
        addressLine: parsed.addressLine || addrRaw,
        city: parsed.city,
        postcode: normalisePostcode(parsed.postcodeRaw),
        postcodeFormatted: formatPostcode(parsed.postcodeRaw),
        partnerSin: (row["Site SIN"] ?? "").trim() || null,
        sapRef: (row["Site SAP"] ?? "").trim() || null,
        opsUnit: (row["Site OPS Unit"] ?? "").trim() || null,
        what3words: (row["what3words"] ?? "").trim() || null,
        partnerStatus,
        startDate: parseDateUK(row["Site Start Date"] ?? ""),
        terminationDate: parseDateUK(row["Site Termination Date"] ?? ""),
        dne: parseBool(row["DNE"] ?? ""),
        hsMarkers: parseBool(row["HS Markers"] ?? ""),
        active,
      },
      rates,
    },
  };
}

/**
 * Parse a CSV and tell the caller what would happen, without touching the
 * database for writes. Reads existing sites (by partnerReference and by
 * postcode + name) to classify rows as "would create" vs "would update".
 */
export async function previewNexusImport(
  prisma: PrismaClient,
  csvText: string,
): Promise<ImportSummary> {
  const rawRows = readCsvRows(csvText);
  const skipped: ImportSkip[] = [];
  const toImport: RowToImport[] = [];
  for (const r of rawRows) {
    const res = rowToImport(r);
    if (res.ok) toImport.push(res.row);
    else skipped.push(res.skip);
  }

  const refs = toImport.map((r) => r.reference);
  const byRef = await prisma.site.findMany({
    where: { partnerReference: { in: refs } },
    select: { id: true, partnerReference: true },
  });
  const refSet = new Set(byRef.map((s) => s.partnerReference!));

  // Secondary lookup: any (postcode, name) matches for refs we didn't find?
  const remaining = toImport.filter((r) => !refSet.has(r.reference));
  let updateBySecondary = 0;
  for (const r of remaining) {
    const hit = await prisma.site.findFirst({
      where: { postcode: r.data.postcode, name: r.data.name },
      select: { id: true },
    });
    if (hit) updateBySecondary++;
  }

  const toUpdate = byRef.length + updateBySecondary;
  const toCreate = toImport.length - toUpdate;
  const ratesToWrite = toImport.reduce((acc, r) => acc + r.rates.length, 0);

  return {
    read: rawRows.length,
    toCreate,
    toUpdate,
    ratesToWrite,
    skipped,
  };
}

/**
 * Actually import. Runs each row in its own transaction (delete site rates +
 * upsert site + insert rates) so a single bad row doesn't roll back the whole
 * batch. Source string identifies the run for later auditing.
 */
export async function runNexusImport(
  prisma: PrismaClient,
  csvText: string,
  source: string = `Nexus CSV ${new Date().toISOString().slice(0, 10)}`,
): Promise<{
  created: number;
  updated: number;
  ratesWritten: number;
  skipped: ImportSkip[];
}> {
  const partner = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  if (!partner) {
    throw new Error(
      `Partner "${NEXUS_PARTNER_NAME}" not found. Run \`npm run db:seed\` first.`,
    );
  }

  const rawRows = readCsvRows(csvText);
  const skipped: ImportSkip[] = [];
  const toImport: RowToImport[] = [];
  for (const r of rawRows) {
    const res = rowToImport(r);
    if (res.ok) toImport.push(res.row);
    else skipped.push(res.skip);
  }

  let created = 0;
  let updated = 0;
  let ratesWritten = 0;

  for (const r of toImport) {
    let existing = await prisma.site.findFirst({
      where: { partnerReference: r.reference },
      select: { id: true },
    });
    if (!existing) {
      existing = await prisma.site.findFirst({
        where: { postcode: r.data.postcode, name: r.data.name },
        select: { id: true },
      });
    }

    let siteId: string;
    if (existing) {
      const u = await prisma.site.update({
        where: { id: existing.id },
        data: {
          ...r.data,
          partnerId: partner.id,
          partnerReference: r.reference,
        },
        select: { id: true },
      });
      siteId = u.id;
      updated++;
    } else {
      const c = await prisma.site.create({
        data: {
          ...r.data,
          partnerId: partner.id,
          partnerReference: r.reference,
        },
        select: { id: true },
      });
      siteId = c.id;
      created++;
    }

    const ops = [
      prisma.siteRate.deleteMany({ where: { siteId } }),
      ...r.rates.map((rate) =>
        prisma.siteRate.create({
          data: {
            siteId,
            service: rate.service as any,
            amount: new Prisma.Decimal(rate.amount),
            unit: rate.unit as any,
            currency: "GBP",
            source,
          },
        }),
      ),
    ];
    await prisma.$transaction(ops);
    ratesWritten += r.rates.length;
  }

  return { created, updated, ratesWritten, skipped };
}
