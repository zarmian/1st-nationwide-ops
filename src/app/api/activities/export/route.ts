import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static-guarding shift",
  DOG_HANDLER_SHIFT: "Dog-handler shift",
  VISIT_PATROL: "Patrol visit",
  VISIT_VPI: "VPI visit",
  SHIFT_STATIC_GUARDING: "Static-guarding shift",
  SHIFT_DOG_HANDLER: "Dog-handler shift",
};

function parseLocalDate(s: string | null, endOfDay = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  // Admin-only — the CSV contains billed/paid columns. Dispatchers run
  // the live board but don't see financials.
  await requireAdmin();

  const url = new URL(req.url);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  const fromDate = parseLocalDate(url.searchParams.get("from")) ?? monthStart;
  const toDate = parseLocalDate(url.searchParams.get("to"), true) ?? monthEnd;

  let customerId = url.searchParams.get("customerId") ?? "";
  let partnerId = url.searchParams.get("partnerId") ?? "";
  const accountId = url.searchParams.get("accountId");
  if (accountId) {
    const [kind, id] = accountId.split(":");
    if (kind === "customer") customerId = id ?? "";
    else if (kind === "partner") partnerId = id ?? "";
  }
  const officerId = url.searchParams.get("officerId") ?? "";
  const siteId = url.searchParams.get("siteId") ?? "";
  const regionId = url.searchParams.get("regionId") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  const status = url.searchParams.get("status") ?? "completed";

  const visitWhere: any = {};
  const jobWhere: any = {};
  const shiftWhere: any = {};
  if (status === "billed") {
    visitWhere.status = "COMPLETED";
    visitWhere.billedAt = { gte: fromDate, lte: toDate };
    jobWhere.completedAt = { not: null };
    jobWhere.billedAt = { gte: fromDate, lte: toDate };
    shiftWhere.status = "COMPLETED";
    shiftWhere.billedAt = { gte: fromDate, lte: toDate };
  } else if (status === "paid") {
    visitWhere.status = "COMPLETED";
    visitWhere.paidAt = { gte: fromDate, lte: toDate };
    jobWhere.completedAt = { not: null };
    jobWhere.paidAt = { gte: fromDate, lte: toDate };
    shiftWhere.status = "COMPLETED";
    shiftWhere.paidAt = { gte: fromDate, lte: toDate };
  } else {
    visitWhere.status = "COMPLETED";
    visitWhere.departedAt = { gte: fromDate, lte: toDate };
    jobWhere.completedAt = { gte: fromDate, lte: toDate };
    shiftWhere.status = "COMPLETED";
    shiftWhere.actualEndedAt = { gte: fromDate, lte: toDate };
  }
  if (officerId) {
    visitWhere.officerId = officerId;
    jobWhere.assignedToUserId = officerId;
    shiftWhere.officerId = officerId;
  }
  if (siteId) {
    visitWhere.siteId = siteId;
    jobWhere.siteId = siteId;
    shiftWhere.siteId = siteId;
  }
  if (customerId) {
    visitWhere.site = { ...(visitWhere.site ?? {}), customerId };
    jobWhere.customerId = customerId;
    shiftWhere.site = { ...(shiftWhere.site ?? {}), customerId };
  }
  if (partnerId) {
    visitWhere.site = { ...(visitWhere.site ?? {}), partnerId };
    jobWhere.partnerId = partnerId;
    shiftWhere.site = { ...(shiftWhere.site ?? {}), partnerId };
  }
  if (regionId && Number.isFinite(Number(regionId))) {
    const rid = Number(regionId);
    visitWhere.site = { ...(visitWhere.site ?? {}), regionId: rid };
    jobWhere.site = { ...(jobWhere.site ?? {}), regionId: rid };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), regionId: rid };
  }

  let loadVisits = true;
  let loadJobs = true;
  let loadShifts = true;
  if (kind === "VISIT_PATROL") {
    loadJobs = false;
    loadShifts = false;
    visitWhere.patrolSchedule = { kind: "PATROL" };
  } else if (kind === "VISIT_VPI") {
    loadJobs = false;
    loadShifts = false;
    visitWhere.patrolSchedule = { kind: "VPI" };
  } else if (kind?.startsWith("SHIFT_")) {
    loadVisits = false;
    loadJobs = false;
    shiftWhere.type = kind.slice("SHIFT_".length);
  } else if (kind) {
    loadVisits = false;
    loadShifts = false;
    jobWhere.type = kind;
  }

  const [visits, jobs, shifts] = await Promise.all([
    loadVisits
      ? prisma.patrolVisit.findMany({
          where: visitWhere,
          include: {
            site: {
              select: {
                code: true,
                name: true,
                region: { select: { name: true } },
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { name: true } },
            patrolSchedule: { select: { kind: true } },
          },
          orderBy: [{ scheduledAt: "desc" }],
        })
      : Promise.resolve([] as any[]),
    loadJobs
      ? prisma.job.findMany({
          where: jobWhere,
          include: {
            site: {
              select: {
                code: true,
                name: true,
                region: { select: { name: true } },
              },
            },
            customer: { select: { name: true } },
            partner: { select: { name: true } },
            assignedTo: { select: { name: true } },
            handledByPartner: { select: { name: true } },
          },
          orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([] as any[]),
    loadShifts
      ? prisma.shift.findMany({
          where: shiftWhere,
          include: {
            site: {
              select: {
                code: true,
                name: true,
                region: { select: { name: true } },
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
            officer: { select: { name: true } },
            handledByPartner: { select: { name: true } },
          },
          orderBy: [{ actualEndedAt: "desc" }, { scheduledStartsAt: "desc" }],
        })
      : Promise.resolve([] as any[]),
  ]);

  type Row = {
    at: Date;
    kind: string;
    siteCode: string | null;
    siteName: string | null;
    region: string | null;
    customer: string | null;
    partner: string | null;
    officer: string | null;
    billed: number | null;
    paid: number | null;
    status: string;
  };

  const rows: Row[] = [];
  for (const v of visits) {
    const vk = v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL";
    rows.push({
      at: v.departedAt ?? v.arrivedAt ?? v.scheduledAt ?? v.createdAt ?? new Date(),
      kind: KIND_LABEL[`VISIT_${vk}`] ?? "Visit",
      siteCode: v.site?.code ?? null,
      siteName: v.site?.name ?? null,
      region: v.site?.region?.name ?? null,
      customer: v.site?.customer?.name ?? null,
      partner: v.site?.partner?.name ?? null,
      officer: v.officer?.name ?? null,
      billed: v.billedAmount != null ? Number(v.billedAmount) : null,
      paid: v.paidAmount != null ? Number(v.paidAmount) : null,
      status: v.status,
    });
  }
  for (const j of jobs) {
    rows.push({
      at: j.completedAt ?? j.scheduledFor ?? j.startedAt ?? j.createdAt ?? new Date(),
      kind: KIND_LABEL[j.type] ?? j.type,
      siteCode: j.site?.code ?? null,
      siteName: j.site?.name ?? null,
      region: j.site?.region?.name ?? null,
      customer: j.customer?.name ?? null,
      partner: j.partner?.name ?? null,
      officer: j.handledByPartner
        ? `${j.handledByPartner.name} (partner)`
        : j.assignedTo?.name ?? null,
      billed: j.billedAmount != null ? Number(j.billedAmount) : null,
      paid: j.paidAmount != null ? Number(j.paidAmount) : null,
      status: j.status,
    });
  }
  for (const s of shifts) {
    rows.push({
      at: s.actualEndedAt ?? s.scheduledStartsAt ?? s.createdAt ?? new Date(),
      kind: KIND_LABEL[`SHIFT_${s.type}`] ?? s.type,
      siteCode: s.site?.code ?? null,
      siteName: s.site?.name ?? null,
      region: s.site?.region?.name ?? null,
      customer: s.site?.customer?.name ?? null,
      partner: s.site?.partner?.name ?? null,
      officer: s.handledByPartner
        ? `${s.handledByPartner.name} (partner)`
        : s.officer?.name ?? null,
      billed: s.billedAmount != null ? Number(s.billedAmount) : null,
      paid: s.paidAmount != null ? Number(s.paidAmount) : null,
      status: s.status,
    });
  }
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  const header = [
    "Date",
    "Service",
    "Site code",
    "Site",
    "Region",
    "Customer",
    "Partner",
    "Officer",
    "Billed (GBP)",
    "Paid (GBP)",
    "Status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.at.toISOString(),
        r.kind,
        r.siteCode,
        r.siteName,
        r.region,
        r.customer,
        r.partner,
        r.officer,
        r.billed != null ? r.billed.toFixed(2) : "",
        r.paid != null ? r.paid.toFixed(2) : "",
        r.status,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `activities-${fromDate.toISOString().slice(0, 10)}-to-${toDate
    .toISOString()
    .slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
