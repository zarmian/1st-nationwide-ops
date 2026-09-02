/**
 * Officer compliance / vetting register — SIA licence, right-to-work, DBS and
 * training certificates, with expiry status. For an SIA-regulated firm this is
 * the record that keeps you audit-ready: deploying a lapsed licence fails ACS
 * assessments and breaches most client contracts.
 *
 * Status per item:
 *   missing  — nothing recorded (SIA/DBS only; a real gap to fill)
 *   expired  — the date has passed
 *   expiring — within the warning window (default 30 days)
 *   valid    — in date (or, for RTW/certs with no expiry, indefinite)
 */
import { prisma } from "@/lib/db";

const DAY_MS = 86_400_000;

export type ComplianceStatus = "missing" | "expired" | "expiring" | "valid";

const RANK: Record<ComplianceStatus, number> = {
  valid: 0,
  expiring: 1,
  missing: 2,
  expired: 3,
};

/** Status of a dated item where a missing date is a gap (SIA, DBS, dated cert). */
export function statusFor(
  date: Date | null,
  asOf: Date,
  warnDays = 30,
): ComplianceStatus {
  if (!date) return "missing";
  const days = Math.floor((date.getTime() - asOf.getTime()) / DAY_MS);
  if (days < 0) return "expired";
  if (days <= warnDays) return "expiring";
  return "valid";
}

export type ComplianceItem = {
  kind: string;
  date: Date | null;
  status: ComplianceStatus;
  note?: string;
};

export type ComplianceOfficer = {
  id: string;
  name: string;
  role: string;
  siaNumber: string | null;
  items: ComplianceItem[];
  worst: ComplianceStatus;
};

export type ComplianceSummary = {
  officers: ComplianceOfficer[];
  counts: { expired: number; missing: number; expiring: number; ok: number };
  attention: ComplianceOfficer[];
};

function buildItems(
  o: {
    siaExpiry: Date | null;
    rightToWorkExpiry: Date | null;
    dbsCheckedOn: Date | null;
    certifications: { name: string; expiresOn: Date | null }[];
  },
  asOf: Date,
  warnDays: number,
): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  // SIA licence — the critical one; a missing expiry is a real gap.
  items.push({ kind: "SIA licence", date: o.siaExpiry, status: statusFor(o.siaExpiry, asOf, warnDays) });
  // Right to work — a null expiry means indefinite (settled/British), not a gap.
  items.push(
    o.rightToWorkExpiry == null
      ? { kind: "Right to work", date: null, status: "valid", note: "Indefinite" }
      : { kind: "Right to work", date: o.rightToWorkExpiry, status: statusFor(o.rightToWorkExpiry, asOf, warnDays) },
  );
  // DBS — not recorded is a gap; no auto-staleness (policy varies).
  items.push({
    kind: "DBS",
    date: o.dbsCheckedOn,
    status: o.dbsCheckedOn ? "valid" : "missing",
    note: o.dbsCheckedOn ? "Last checked" : undefined,
  });
  // Certificates — a cert with no expiry is treated as non-expiring.
  for (const c of o.certifications) {
    items.push({
      kind: c.name,
      date: c.expiresOn,
      status: c.expiresOn ? statusFor(c.expiresOn, asOf, warnDays) : "valid",
    });
  }
  return items;
}

function worstOf(items: ComplianceItem[]): ComplianceStatus {
  return items.reduce<ComplianceStatus>(
    (acc, i) => (RANK[i.status] > RANK[acc] ? i.status : acc),
    "valid",
  );
}

export async function loadComplianceRegister(
  asOf: Date = new Date(),
  warnDays = 30,
): Promise<ComplianceSummary> {
  const officers = await prisma.user.findMany({
    where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      role: true,
      siaNumber: true,
      siaExpiry: true,
      rightToWorkExpiry: true,
      dbsCheckedOn: true,
      certifications: {
        orderBy: { expiresOn: "asc" },
        select: { name: true, expiresOn: true },
      },
    },
  });

  const rows: ComplianceOfficer[] = officers.map((o) => {
    const items = buildItems(o, asOf, warnDays);
    return {
      id: o.id,
      name: o.name,
      role: o.role,
      siaNumber: o.siaNumber,
      items,
      worst: worstOf(items),
    };
  });

  const counts = { expired: 0, missing: 0, expiring: 0, ok: 0 };
  for (const r of rows) {
    if (r.worst === "expired") counts.expired++;
    else if (r.worst === "missing") counts.missing++;
    else if (r.worst === "expiring") counts.expiring++;
    else counts.ok++;
  }
  // Worst-first, then by name.
  const order = (r: ComplianceOfficer) => RANK[r.worst];
  const attention = rows
    .filter((r) => r.worst !== "valid")
    .sort((a, b) => order(b) - order(a) || a.name.localeCompare(b.name));

  return { officers: rows, counts, attention };
}

export type ExpiringItem = {
  officerName: string;
  kind: string;
  date: Date | null;
  status: ComplianceStatus;
};

/** Flat list of expired / soon-expiring items, for the weekly alert cron. */
export async function expiringComplianceItems(
  withinDays: number,
  asOf: Date = new Date(),
): Promise<ExpiringItem[]> {
  const { officers } = await loadComplianceRegister(asOf, withinDays);
  const out: ExpiringItem[] = [];
  for (const o of officers) {
    for (const i of o.items) {
      if (i.status === "expired" || i.status === "expiring" || (i.kind === "SIA licence" && i.status === "missing")) {
        out.push({ officerName: o.name, kind: i.kind, date: i.date, status: i.status });
      }
    }
  }
  // Expired first, then soonest expiry.
  return out.sort(
    (a, b) =>
      RANK[b.status] - RANK[a.status] ||
      (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity),
  );
}
