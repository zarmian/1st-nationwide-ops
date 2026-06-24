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

  const splitCsv = (v: string | null): string[] =>
    v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

  let customerIds = splitCsv(url.searchParams.get("customerId"));
  let partnerIds = splitCsv(url.searchParams.get("partnerId"));
  const accountId = url.searchParams.get("accountId");
  if (accountId) {
    const [aKind, id] = accountId.split(":");
    if (aKind === "customer" && id) customerIds = [id];
    else if (aKind === "partner" && id) partnerIds = [id];
  }
  const officerIds = splitCsv(url.searchParams.get("officerId"));
  const siteIds = splitCsv(url.searchParams.get("siteId"));
  const regionIds = splitCsv(url.searchParams.get("regionId"))
    .map((r) => Number(r))
    .filter((n) => Number.isFinite(n));
  const kinds = splitCsv(url.searchParams.get("kind"));
  // Status semantics match /activities — anchor date on scheduled-for,
  // narrow stage by status group.
  const statuses = splitCsv(url.searchParams.get("status"));

  const dateInRange = { gte: fromDate, lte: toDate };
  const visitWhere: any = {
    OR: [
      { scheduledAt: dateInRange },
      { AND: [{ scheduledAt: null }, { createdAt: dateInRange }] },
    ],
  };
  const jobWhere: any = {
    OR: [
      { scheduledFor: dateInRange },
      { AND: [{ scheduledFor: null }, { createdAt: dateInRange }] },
    ],
  };
  const shiftWhere: any = {
    scheduledStartsAt: dateInRange,
  };
  if (officerIds.length) {
    visitWhere.officerId = { in: officerIds };
    jobWhere.assignedToUserId = { in: officerIds };
    shiftWhere.officerId = { in: officerIds };
  }
  if (siteIds.length) {
    visitWhere.siteId = { in: siteIds };
    jobWhere.siteId = { in: siteIds };
    shiftWhere.siteId = { in: siteIds };
  }
  if (customerIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), customerId: { in: customerIds } };
    jobWhere.customerId = { in: customerIds };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), customerId: { in: customerIds } };
  }
  if (partnerIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), partnerId: { in: partnerIds } };
    jobWhere.partnerId = { in: partnerIds };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), partnerId: { in: partnerIds } };
  }
  if (regionIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), regionId: { in: regionIds } };
    jobWhere.site = { ...(jobWhere.site ?? {}), regionId: { in: regionIds } };
    shiftWhere.site = { ...(shiftWhere.site ?? {}), regionId: { in: regionIds } };
  }

  const kindSet = new Set(kinds);
  const wantVisitPatrol = kindSet.has("VISIT_PATROL");
  const wantVisitVpi = kindSet.has("VISIT_VPI");
  const wantShiftStatic =
    kindSet.has("STATIC_GUARDING_SHIFT") || kindSet.has("SHIFT_STATIC_GUARDING");
  const wantShiftDog =
    kindSet.has("DOG_HANDLER_SHIFT") || kindSet.has("SHIFT_DOG_HANDLER");
  const jobKinds = [...kindSet].filter(
    (k) =>
      k !== "VISIT_PATROL" &&
      k !== "VISIT_VPI" &&
      k !== "STATIC_GUARDING_SHIFT" &&
      k !== "DOG_HANDLER_SHIFT" &&
      k !== "SHIFT_STATIC_GUARDING" &&
      k !== "SHIFT_DOG_HANDLER",
  );

  let loadVisits = true;
  let loadJobs = true;
  let loadShifts = true;
  if (kinds.length > 0) {
    const wantsAnyVisit = wantVisitPatrol || wantVisitVpi;
    const wantsAnyShift = wantShiftStatic || wantShiftDog;
    const wantsAnyJob = jobKinds.length > 0;
    loadVisits = wantsAnyVisit;
    loadJobs = wantsAnyJob;
    loadShifts = wantsAnyShift;
    if (wantsAnyVisit) {
      const visitKindFilter: string[] = [];
      if (wantVisitPatrol) visitKindFilter.push("PATROL");
      if (wantVisitVpi) visitKindFilter.push("VPI");
      visitWhere.patrolSchedule = { kind: { in: visitKindFilter } };
    }
    if (wantsAnyJob) jobWhere.type = { in: jobKinds };
    if (wantShiftStatic && !wantShiftDog) shiftWhere.type = "STATIC_GUARDING";
    else if (wantShiftDog && !wantShiftStatic) shiftWhere.type = "DOG_HANDLER";
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
  if (statuses.length > 0) {
    const STATUS_GROUPS: Record<string, Set<string>> = {
      scheduled: new Set(["OPEN", "ASSIGNED", "PENDING", "DRAFT"]),
      in_progress: new Set([
        "IN_PROGRESS",
        "SUBMITTED",
        "REVIEW_PENDING",
        "LATE",
      ]),
      completed: new Set([
        "COMPLETED",
        "APPROVED",
        "SENT_TO_CLIENT",
        "CLOSED",
        "EDITED_AND_APPROVED",
      ]),
      missed: new Set(["MISSED", "ABANDONED"]),
      cancelled: new Set(["CANCELLED"]),
    };
    const allowed = new Set<string>();
    for (const g of statuses) {
      const set = STATUS_GROUPS[g];
      if (!set) continue;
      for (const s of set) allowed.add(s);
    }
    rows.splice(0, rows.length, ...rows.filter((r) => allowed.has(r.status)));
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
