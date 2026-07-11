"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluateGeofence, roundMeters } from "@/lib/geo";
import { logActivity } from "@/lib/audit";
import {
  computeCheckSlots,
  openSlotAt,
  nextSlotAfter,
} from "@/lib/shiftChecks";
import {
  applyBillingToShift,
  applyPayToShift,
  billForSite,
  durationMinutes,
  jobTypeToRateService,
  payForOfficer,
  roundUpToHalfHour,
} from "@/lib/billing";

/**
 * Public, token-gated officer actions for a single shift. NO session — the
 * token in the URL is the only credential, and each action re-loads the
 * shift by token and re-checks the geofence server-side (the client display
 * is advisory; this is the authoritative block).
 */

export type GpsInput = { lat: number; lng: number; accuracy?: number | null };

export type DutyResult = {
  ok: boolean;
  error?: string;
  /** Set when the block was a geofence failure, for a clearer message. */
  distanceM?: number | null;
  radiusM?: number;
  /** Set when end is blocked pending a late reason. */
  needsLateReason?: boolean;
  /** Set when a check-in was rejected because it's outside the time window. */
  checkNotOpen?: boolean;
};

function ukTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function loadByToken(token: string) {
  if (!token) return null;
  return prisma.shift.findUnique({
    where: { publicToken: token },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          code: true,
          lat: true,
          lng: true,
          geofenceRadiusM: true,
        },
      },
      officer: { select: { id: true, name: true } },
      handledByPartnerOfficer: { select: { name: true } },
    },
  });
}

type LoadedShift = NonNullable<Awaited<ReturnType<typeof loadByToken>>>;

function knownName(shift: LoadedShift): string {
  return (
    shift.officerNameRaw?.trim() ||
    shift.officer?.name ||
    shift.handledByPartnerOfficer?.name ||
    "Officer"
  );
}

function geofenceFor(shift: LoadedShift, gps: GpsInput) {
  return evaluateGeofence({
    siteLat: shift.site.lat,
    siteLng: shift.site.lng,
    radiusM: shift.site.geofenceRadiusM,
    gpsLat: gps.lat,
    gpsLng: gps.lng,
  });
}

function outOfRange(geo: ReturnType<typeof geofenceFor>): DutyResult | null {
  if (geo.enforced && !geo.withinRadius) {
    return {
      ok: false,
      error: `You're about ${roundMeters(geo.distanceM)} m from the site. Move within ${geo.radiusM} m and try again.`,
      distanceM: roundMeters(geo.distanceM),
      radiusM: geo.radiusM,
    };
  }
  return null;
}

export async function startDuty(input: {
  token: string;
  name?: string;
  gps: GpsInput;
}): Promise<DutyResult> {
  const shift = await loadByToken(input.token);
  if (!shift) return { ok: false, error: "This link is invalid or has expired." };
  if (shift.status === "COMPLETED" || shift.status === "ABANDONED") {
    return { ok: false, error: "This shift is already closed." };
  }
  if (shift.status === "IN_PROGRESS") {
    return { ok: false, error: "This shift is already started." };
  }

  // Identity: if not pre-assigned and no name on file, the officer must
  // type one before starting.
  const providedName = (input.name ?? "").trim();
  const hasIdentity =
    Boolean(shift.officerId) ||
    Boolean(shift.handledByPartnerOfficerId) ||
    Boolean(shift.officerNameRaw?.trim()) ||
    providedName.length > 0;
  if (!hasIdentity) {
    return { ok: false, error: "Enter your name to start the shift." };
  }

  const geo = geofenceFor(shift, input.gps);
  const blocked = outOfRange(geo);
  if (blocked) return blocked;

  // If a logged-in officer opened their own shift via /m/today (the link
  // is the same /duty page), claim an unassigned, non-partner shift to
  // them so the finance snapshot at end-of-shift can compute their pay.
  let claimOfficerId = shift.officerId;
  if (!shift.officerId && !shift.handledByPartnerId) {
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
    if (sessionUserId) claimOfficerId = sessionUserId;
  }

  await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: "IN_PROGRESS",
      actualStartedAt: shift.actualStartedAt ?? new Date(),
      officerId: claimOfficerId,
      startLat: input.gps.lat,
      startLng: input.gps.lng,
      startGpsAccuracy: input.gps.accuracy ?? null,
      startDistanceM: roundMeters(geo.distanceM),
      startWithinGeofence: geo.enforced ? geo.withinRadius : null,
      officerNameRaw:
        !shift.officerId && !shift.handledByPartnerOfficerId && providedName
          ? providedName
          : shift.officerNameRaw,
    },
  });

  await logActivity({
    entity: "Shift",
    entityId: shift.id,
    action: "started_on_duty",
    userId: shift.officerId ?? null,
    diff: {
      distanceM: roundMeters(geo.distanceM),
      geofenceEnforced: geo.enforced,
      withinGeofence: geo.enforced ? geo.withinRadius : null,
    },
  });

  revalidatePath(`/duty/${input.token}`);
  revalidatePath(`/shifts/${shift.id}`);
  return { ok: true };
}

export async function checkInDuty(input: {
  token: string;
  gps: GpsInput;
  photoUrl: string;
}): Promise<DutyResult> {
  const shift = await loadByToken(input.token);
  if (!shift) return { ok: false, error: "This link is invalid or has expired." };
  if (shift.status !== "IN_PROGRESS") {
    return { ok: false, error: "Start the shift before checking in." };
  }
  if (!input.photoUrl) {
    return { ok: false, error: "Take a photo to complete the check-in." };
  }

  // Time window: a check-in is only accepted from 10 min before it's due
  // until the grace buffer runs out. This is the authoritative check — the
  // duty page also enforces it client-side, but never trust the client.
  const now = new Date();
  const slots = computeCheckSlots({
    startBasis: shift.actualStartedAt ?? shift.scheduledStartsAt,
    endBasis: shift.scheduledEndsAt,
    intervalMin: shift.checkIntervalMin,
    graceMin: shift.graceMinutes,
  });
  const openSlot = openSlotAt(slots, now);
  if (!openSlot) {
    const next = nextSlotAfter(slots, now);
    return {
      ok: false,
      checkNotOpen: true,
      error: next
        ? `It's not check-in time yet. The next check-in opens at ${ukTime(next.opensAt)}.`
        : "No more check-ins are due for this shift.",
    };
  }
  // One check-in per slot.
  const already = await prisma.formSubmission.findFirst({
    where: {
      shiftId: shift.id,
      form: "SHIFT_CHECK",
      payload: { path: ["slotIndex"], equals: openSlot.index },
    },
    select: { id: true },
  });
  if (already) {
    const next = nextSlotAfter(slots, now);
    return {
      ok: false,
      checkNotOpen: true,
      error: next
        ? `Already checked in for this window. The next opens at ${ukTime(next.opensAt)}.`
        : "Already checked in for the final window.",
    };
  }

  const geo = geofenceFor(shift, input.gps);
  const blocked = outOfRange(geo);
  if (blocked) return blocked;

  await prisma.formSubmission.create({
    data: {
      form: "SHIFT_CHECK",
      shiftId: shift.id,
      siteId: shift.siteId,
      submittedByUserId: shift.officerId ?? null,
      officerNameRaw: knownName(shift),
      payload: {
        kind: "hourly_check",
        slotIndex: openSlot.index,
        dueAt: openSlot.dueAt.toISOString(),
        gps: {
          lat: input.gps.lat,
          lng: input.gps.lng,
          accuracy: input.gps.accuracy ?? null,
        },
        distanceM: roundMeters(geo.distanceM),
        withinGeofence: geo.enforced ? geo.withinRadius : null,
        photoUrl: input.photoUrl,
      },
    },
  });

  revalidatePath(`/duty/${input.token}`);
  revalidatePath(`/shifts/${shift.id}`);
  return { ok: true };
}

export async function endDuty(input: {
  token: string;
  gps: GpsInput;
  lateReason?: string;
}): Promise<DutyResult> {
  const shift = await loadByToken(input.token);
  if (!shift) return { ok: false, error: "This link is invalid or has expired." };
  if (shift.status !== "IN_PROGRESS") {
    return { ok: false, error: "This shift isn't currently running." };
  }

  const geo = geofenceFor(shift, input.gps);
  const blocked = outOfRange(geo);
  if (blocked) return blocked;

  const endedAt = new Date();
  const isLate = endedAt.getTime() > shift.scheduledEndsAt.getTime();
  const reason = (input.lateReason ?? "").trim();
  if (isLate && !reason) {
    return {
      ok: false,
      needsLateReason: true,
      error: "You're ending after the scheduled end time. Add a brief reason.",
    };
  }

  const startedAt = shift.actualStartedAt ?? shift.scheduledStartsAt;
  const worked = durationMinutes(startedAt, endedAt);
  const payable = roundUpToHalfHour(worked);

  await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: "COMPLETED",
      actualEndedAt: endedAt,
      endLat: input.gps.lat,
      endLng: input.gps.lng,
      endGpsAccuracy: input.gps.accuracy ?? null,
      endDistanceM: roundMeters(geo.distanceM),
      endWithinGeofence: geo.enforced ? geo.withinRadius : null,
      endedLate: isLate,
      lateReason: isLate ? reason : null,
      payableMinutes: payable,
    },
  });

  // Finance snapshot. Bill on actual worked duration; pay the officer on
  // the 30-min-rounded payable minutes. Officer pay only for own officers
  // (partner cost is tracked separately on the partner portal).
  const rateService = jobTypeToRateService(shift.type);
  if (rateService) {
    const bill = await billForSite(shift.siteId, rateService, worked);
    await applyBillingToShift(shift.id, bill);
    if (shift.officerId) {
      const pay = await payForOfficer(shift.officerId, rateService, payable);
      await applyPayToShift(shift.id, pay);
    }
  }

  await logActivity({
    entity: "Shift",
    entityId: shift.id,
    action: "ended_on_duty",
    userId: shift.officerId ?? null,
    diff: {
      endedLate: isLate,
      lateReason: isLate ? reason : null,
      workedMinutes: worked,
      payableMinutes: payable,
      distanceM: roundMeters(geo.distanceM),
    },
  });

  revalidatePath(`/duty/${input.token}`);
  revalidatePath(`/shifts/${shift.id}`);
  revalidatePath("/finance");
  return { ok: true };
}
