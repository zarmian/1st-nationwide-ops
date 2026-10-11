/**
 * Alarm register for the Claude connector — same SLA maths as /alarms
 * (computeAlarmSla / summariseAlarmSla, AlarmEvent.priority, response =
 * received → officer on site), over UK days of the alarm's received time.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { siteRefHiddenAnd } from "@/lib/hiddenAccounts";
import { computeAlarmSla, summariseAlarmSla } from "@/lib/alarmSla";
import {
  matchCustomers,
  matchSites,
  resolveDayRange,
  siteLabel,
  ukDayOffset,
  ukIso,
  ukToday,
  type ToolContext,
} from "./common";

export async function listAlarms(
  ctx: ToolContext,
  input: {
    from?: string;
    to?: string;
    site?: string;
    customer?: string;
    priority?: "HIGH" | "MEDIUM" | "LOW";
    state?: "open" | "closed" | "all";
    limit: number;
  },
) {
  const range = resolveDayRange(
    input,
    { from: ukDayOffset(ctx.now, -6), to: ukToday(ctx.now) },
    366,
  );
  const sites = input.site ? await matchSites(input.site) : null;
  const customers = input.customer ? await matchCustomers(input.customer) : null;

  const where: Prisma.AlarmEventWhereInput = {
    AND: [
      { receivedAt: { gte: range.fromDate, lte: range.toDate } },
      ...siteRefHiddenAnd(ctx.hidden),
      ...(sites ? [{ siteId: { in: sites.ids } }] : []),
      ...(customers ? [{ site: { customerId: { in: customers.ids } } }] : []),
      ...(input.priority ? [{ priority: input.priority }] : []),
      ...(input.state === "open" ? [{ closedAt: null }] : []),
      ...(input.state === "closed" ? [{ closedAt: { not: null } }] : []),
    ],
  };

  // Summary over the whole window (not just the rows shown).
  const all = await prisma.alarmEvent.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 2000,
    select: {
      id: true,
      receivedAt: true,
      priority: true,
      source: true,
      zone: true,
      outcome: true,
      closedAt: true,
      site: { select: { code: true, name: true, customer: { select: { name: true } } } },
      job: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          assignedTo: { select: { name: true } },
          handledByPartner: { select: { name: true } },
        },
      },
    },
  });

  const rows = all.map((a) => ({
    a,
    sla: computeAlarmSla({
      receivedAt: a.receivedAt,
      arrivedAt: a.job?.startedAt ?? null,
      priority: a.priority,
      now: ctx.now,
    }),
  }));
  const summary = summariseAlarmSla(
    rows.map(({ sla }) => ({ status: sla.status, responseMins: sla.responseMins, arrived: sla.arrived })),
  );

  return {
    from: range.from,
    to: range.to,
    matchedSites: sites?.names,
    matchedCustomers: customers?.names,
    summary: {
      ...summary,
      slaTargets: "High 20 min, Medium 45 min, Low 90 min (received → officer on site)",
    },
    count: all.length,
    shown: Math.min(all.length, input.limit),
    alarms: rows.slice(0, input.limit).map(({ a, sla }) => ({
      alarmId: a.id,
      jobId: a.job?.id ?? null,
      received: ukIso(a.receivedAt),
      site: siteLabel(a.site),
      customer: a.site.customer?.name ?? null,
      priority: a.priority,
      source: a.source,
      zone: a.zone,
      officer: a.job?.assignedTo?.name ?? null,
      subcontractedTo: a.job?.handledByPartner?.name ?? null,
      onSite: ukIso(a.job?.startedAt),
      responseMinutes: sla.responseMins,
      sla: sla.status,
      outcome: a.outcome,
      closed: ukIso(a.closedAt),
    })),
  };
}
