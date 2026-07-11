import { prisma } from "@/lib/db";
import { durationMinutes } from "@/lib/billing";
import { computeCheckSlots } from "@/lib/shiftChecks";

/**
 * Assembles the customer-facing data for a static-guarding / dog-handler shift
 * report. Deliberately excludes anything internal (pay, rates, billing, raw
 * GPS, geofence distances) — the customer sees presence, times and check-ins.
 */

const TYPE_LABEL: Record<string, string> = {
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

export type ShiftCheckRow = {
  n: number;
  time: string;
  onSite: boolean | null; // within the site geofence at check-in
};

export type ShiftReportData = {
  reportRef: string;
  siteName: string;
  siteCode: string | null;
  siteAddress: string;
  forName: string | null; // customer or partner the report is for
  shiftType: string;
  officerLabel: string;
  subcontracted: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  totalOnSite: string | null;
  statusLabel: string;
  endedLate: boolean;
  lateReason: string | null;
  checkExpected: number;
  checkDone: number;
  checkMissed: number;
  checkIns: ShiftCheckRow[];
  generatedAt: string;
};

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

function ukTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function hoursMinutes(mins: number | null): string | null {
  if (mins == null || mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function loadShiftReportData(
  shiftId: string,
  now: Date = new Date(),
): Promise<ShiftReportData | null> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      site: {
        select: {
          name: true,
          code: true,
          addressLine: true,
          postcodeFormatted: true,
          customer: { select: { name: true } },
          partner: { select: { name: true } },
        },
      },
      officer: { select: { name: true } },
      handledByPartner: { select: { name: true } },
      handledByPartnerOfficer: { select: { name: true } },
      formSubmissions: {
        where: { form: "SHIFT_CHECK" },
        orderBy: { submittedAt: "asc" },
        select: { submittedAt: true, payload: true },
      },
    },
  });
  if (!shift) return null;

  const slots = computeCheckSlots({
    startBasis: shift.actualStartedAt ?? shift.scheduledStartsAt,
    endBasis: shift.actualEndedAt ?? shift.scheduledEndsAt,
    intervalMin: shift.checkIntervalMin,
    graceMin: shift.graceMinutes,
  });

  const doneIndices = new Set<number>();
  const checkIns: ShiftCheckRow[] = shift.formSubmissions.map((s, i) => {
    const p = (s.payload ?? {}) as {
      slotIndex?: unknown;
      withinGeofence?: unknown;
    };
    const n = typeof p.slotIndex === "number" ? p.slotIndex : i + 1;
    doneIndices.add(n);
    return {
      n,
      time: ukTime(s.submittedAt),
      onSite: typeof p.withinGeofence === "boolean" ? p.withinGeofence : null,
    };
  });

  const checkMissed = slots.filter((s) => !doneIndices.has(s.index)).length;

  const partnerName = shift.handledByPartner?.name ?? null;
  const officerLabel = partnerName
    ? `${partnerName}${shift.handledByPartnerOfficer?.name ? ` — ${shift.handledByPartnerOfficer.name}` : ""}`
    : shift.officer?.name ?? shift.officerNameRaw ?? "—";

  const worked = durationMinutes(shift.actualStartedAt, shift.actualEndedAt);

  return {
    reportRef: shift.id.slice(0, 8).toUpperCase(),
    siteName: shift.site.name,
    siteCode: shift.site.code,
    siteAddress: `${shift.site.addressLine}, ${shift.site.postcodeFormatted}`,
    forName: shift.site.customer?.name ?? shift.site.partner?.name ?? null,
    shiftType: TYPE_LABEL[shift.type] ?? shift.type,
    officerLabel,
    subcontracted: Boolean(partnerName),
    scheduledStart: ukDateTime(shift.scheduledStartsAt),
    scheduledEnd: ukDateTime(shift.scheduledEndsAt),
    actualStart: shift.actualStartedAt ? ukDateTime(shift.actualStartedAt) : null,
    actualEnd: shift.actualEndedAt ? ukDateTime(shift.actualEndedAt) : null,
    totalOnSite: hoursMinutes(worked),
    statusLabel: shift.status.replace(/_/g, " ").toLowerCase(),
    endedLate: shift.endedLate,
    lateReason: shift.lateReason,
    checkExpected: slots.length,
    checkDone: checkIns.length,
    checkMissed,
    checkIns,
    generatedAt: ukDateTime(now),
  };
}
