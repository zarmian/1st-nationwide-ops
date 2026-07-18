import { prisma } from "@/lib/db";
import { jobScheduledRange, shiftScheduledRange } from "@/lib/activityWhen";
import { ukWallClockToUtc } from "@/lib/dates";

/**
 * Data for the Shurgard daily PDF report.
 *
 * Callouts / lock-ups / unlocks are grouped BY SITE into a single label:
 *   - a lock + unlock on the same site → "Norbury (Lock and Unlock)"
 *   - anything Nexus subcontracted     → "Neasden (Nexus)"
 *   - a callout by our own officer / another partner → just "Neasden"
 * Static guarding (Shurgard OR Access Storage) shows site name + start/end
 * only — no officer, no site id.
 */

export type UkDay = { year: number; month: number; day: number };

export type ShurgardReportData = {
  dateLabel: string;
  shurgardFound: boolean;
  jobSites: string[]; // grouped, formatted site labels
  shifts: { label: string; hours: string }[];
  generatedAt: string;
};

function ukTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ukDateTime(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function loadShurgardReport(
  day: UkDay,
  now: Date = new Date(),
): Promise<ShurgardReportData> {
  const dayStart = ukWallClockToUtc(day.year, day.month, day.day, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const dateLabel = ukWallClockToUtc(
    day.year,
    day.month,
    day.day,
    12,
    0,
  ).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const [shurgard, access, nexus] = await Promise.all([
    prisma.customer.findFirst({
      where: { name: { contains: "Shurgard", mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.customer.findFirst({
      where: { name: { contains: "Access", mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.partner.findFirst({
      where: { name: { contains: "Nexus", mode: "insensitive" } },
      select: { id: true },
    }),
  ]);
  const nexusId = nexus?.id ?? null;

  // ── Callouts + lock/unlocks, grouped by site ──────────────────────────
  const jobs = shurgard
    ? await prisma.job.findMany({
        where: {
          site: { is: { customerId: shurgard.id } },
          status: { not: "CANCELLED" },
          completedAt: { not: null },
          ...jobScheduledRange(dayStart, dayEnd),
        },
        select: {
          type: true,
          scheduledFor: true,
          completedAt: true,
          handledByPartnerId: true,
          site: { select: { id: true, name: true } },
        },
      })
    : [];

  type Group = {
    name: string;
    hasLock: boolean;
    hasUnlock: boolean;
    byNexus: boolean;
    earliest: number;
  };
  const bySite = new Map<string, Group>();
  for (const j of jobs) {
    if (!j.site) continue;
    const g = bySite.get(j.site.id) ?? {
      name: j.site.name,
      hasLock: false,
      hasUnlock: false,
      byNexus: false,
      earliest: Number.POSITIVE_INFINITY,
    };
    if (j.type === "LOCK") g.hasLock = true;
    if (j.type === "UNLOCK") g.hasUnlock = true;
    if (nexusId && j.handledByPartnerId === nexusId) g.byNexus = true;
    const when = (j.scheduledFor ?? j.completedAt ?? dayStart).getTime();
    if (when < g.earliest) g.earliest = when;
    bySite.set(j.site.id, g);
  }

  const jobSites = Array.from(bySite.values())
    .sort((a, b) => a.earliest - b.earliest)
    .map((g) => {
      const parts: string[] = [];
      if (g.hasLock && g.hasUnlock) parts.push("Lock and Unlock");
      else if (g.hasLock) parts.push("Lock");
      else if (g.hasUnlock) parts.push("Unlock");
      if (g.byNexus) parts.push("Nexus");
      return parts.length ? `${g.name} (${parts.join(", ")})` : g.name;
    });

  // ── Static guarding — Shurgard OR Access Storage ──────────────────────
  const storageIds = [shurgard?.id, access?.id].filter(
    (id): id is string => Boolean(id),
  );
  const rawShifts = storageIds.length
    ? await prisma.shift.findMany({
        where: {
          type: "STATIC_GUARDING",
          status: "COMPLETED",
          site: { is: { customerId: { in: storageIds } } },
          ...shiftScheduledRange(dayStart, dayEnd),
        },
        orderBy: { scheduledStartsAt: "asc" },
        select: {
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          actualStartedAt: true,
          actualEndedAt: true,
          handledByPartnerId: true,
          site: { select: { name: true } },
        },
      })
    : [];

  const shifts = rawShifts.map((s) => {
    const label =
      nexusId && s.handledByPartnerId === nexusId
        ? `${s.site.name} (Nexus)`
        : s.site.name;
    const start = s.actualStartedAt ?? s.scheduledStartsAt;
    const end = s.actualEndedAt ?? s.scheduledEndsAt;
    return { label, hours: `${ukTime(start)} – ${ukTime(end)}` };
  });

  return {
    dateLabel,
    shurgardFound: Boolean(shurgard),
    jobSites,
    shifts,
    generatedAt: ukDateTime(now),
  };
}
