/**
 * Forward-dispatch callout creation for the Telegram bot.
 *
 * Mirrors the core of the /dispatch "New job" server action (createJob):
 * a dispatcher assigns a callout that's about to be attended, so the Job
 * lands at ASSIGNED (or OPEN if nobody's on it yet) — NOT the retrospective
 * APPROVED path used by the record-callout form. This is the shape that
 * feeds Telegram notifications: assign here, ping the assignee next.
 *
 * Kept self-contained (its own field checks, no shared zod with the server
 * action) because a "use server" action file can only export async
 * functions — its input schema can't be imported here. The bot's inputs
 * are pre-resolved to real ids by lib/telegramCallout, and every id is
 * re-checked against the DB below before the Job is written.
 */
import type { Job } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  applyPayToJob,
  billForSite,
  jobTypeToRateService,
  payForOfficer,
} from "@/lib/billing";
import { notifyAlarmReceived } from "@/lib/notifications";
import {
  alertAlarmReceivedTelegram,
  notifyAssignedOfficerOfJob,
} from "@/lib/telegramNotify";
import type { BotCalloutData } from "@/lib/calloutTypes";

// Re-export the shared callout types/enums so existing importers can keep
// pulling them from "@/lib/callouts".
export {
  BOT_CALLOUT_TYPES,
  BOT_CALLOUT_SOURCES,
} from "@/lib/calloutTypes";
export type {
  BotCalloutType,
  BotCalloutSource,
  BotCalloutData,
} from "@/lib/calloutTypes";

export type BotCalloutResult =
  | {
      ok: true;
      jobId: string;
      siteId: string;
      status: "ASSIGNED" | "OPEN";
      alarmEventId: string | null;
    }
  | { ok: false; error: string };

/**
 * Create a forward-dispatch callout Job from already-resolved ids.
 * `me` is the recording staff member. Returns a flat result the Telegram
 * webhook turns into a reply. Fires the standard alarm notification for
 * ALARM_RESPONSE jobs, exactly like the dispatch form.
 */
export async function createBotCallout(
  data: BotCalloutData,
  me: { id: string },
): Promise<BotCalloutResult> {
  const site = await prisma.site.findUnique({
    where: { id: data.siteId },
    select: { id: true, customerId: true, partnerId: true, active: true },
  });
  if (!site) return { ok: false, error: "Site not found." };
  if (!site.active) return { ok: false, error: "That site is inactive." };

  let assignedToUserId: string | null = null;
  let handlerPartnerId: string | null = null;

  if (data.handlerKind === "officer") {
    if (data.assignedToUserId) {
      const officer = await prisma.user.findUnique({
        where: { id: data.assignedToUserId },
        select: { id: true, active: true },
      });
      if (!officer) return { ok: false, error: "Officer not found." };
      if (!officer.active) return { ok: false, error: "That officer is inactive." };
      assignedToUserId = officer.id;
    }
  } else {
    if (!data.handlerPartnerId) {
      return { ok: false, error: "No partner given to hand the callout to." };
    }
    const partner = await prisma.partner.findUnique({
      where: { id: data.handlerPartnerId },
      select: { id: true, role: true, active: true },
    });
    if (!partner) return { ok: false, error: "Partner not found." };
    if (!partner.active) return { ok: false, error: "That partner is inactive." };
    if (partner.role !== "SUBCONTRACTOR" && partner.role !== "BOTH") {
      return {
        ok: false,
        error:
          "Only subcontractor partners (Nexus, Keyholding Co) can take a sub'd callout.",
      };
    }
    handlerPartnerId = partner.id;
  }

  // Alarm responses get an AlarmEvent so the existing alarm views + the
  // WhatsApp "alarm received" notification light up. Bot-created alarms are
  // MANUAL source — the operator can refine it later in the app.
  let alarmEventId: string | null = null;
  if (data.type === "ALARM_RESPONSE") {
    const alarm = await prisma.alarmEvent.create({
      data: {
        siteId: data.siteId,
        source: "MANUAL" as any,
        priority: data.priority as any,
        assignedToId: assignedToUserId,
      },
      select: { id: true },
    });
    alarmEventId = alarm.id;
  }

  // ASSIGNED once someone (officer or partner) is on it; OPEN otherwise.
  const status: "ASSIGNED" | "OPEN" =
    assignedToUserId || handlerPartnerId ? "ASSIGNED" : "OPEN";

  const scheduledFor = data.scheduledFor ?? new Date();

  const created: Pick<Job, "id" | "siteId"> = await prisma.job.create({
    data: {
      type: data.type as any,
      typeLabel: data.typeLabel ?? null,
      source: data.source as any,
      status: status as any,
      priority: data.priority as any,
      siteId: data.siteId,
      customerId: site.customerId,
      partnerId: site.partnerId,
      responderType:
        data.handlerKind === "partner"
          ? ("PARTNER" as any)
          : ("INTERNAL_OFFICER" as any),
      assignedToUserId,
      handledByPartnerId: handlerPartnerId,
      externalResponder:
        data.handlerKind === "partner" ? data.partnerOfficerName ?? null : null,
      alarmEventId,
      scheduledFor,
      notes: data.notes,
      recordedByUserId: me.id,
    },
    select: { id: true, siteId: true },
  });

  // Best-effort billing snapshot; officer pay only when WE attend.
  // Accounting date = the scheduled date we just stamped.
  const rateService = jobTypeToRateService(data.type);
  if (rateService) {
    const at = scheduledFor;
    const bill = await billForSite(data.siteId, rateService);
    if (bill.ok) await applyBillingToJob(created.id, bill, at);
    if (assignedToUserId) {
      const pay = await payForOfficer(assignedToUserId, rateService);
      if (pay.ok) await applyPayToJob(created.id, pay, at);
    }
  }

  if (alarmEventId) {
    notifyAlarmReceived(alarmEventId).catch((e) =>
      console.error("notifyAlarmReceived failed", e),
    );
    // Heads-up to all linked dispatch/admin on Telegram.
    alertAlarmReceivedTelegram(alarmEventId).catch((e) =>
      console.error("alertAlarmReceivedTelegram failed", e),
    );
  }

  // Ping the assignee on Telegram if they've linked it (no-op otherwise).
  if (assignedToUserId) {
    notifyAssignedOfficerOfJob(created.id).catch((e) =>
      console.error("notifyAssignedOfficerOfJob failed", e),
    );
  }

  return {
    ok: true,
    jobId: created.id,
    siteId: data.siteId,
    status,
    alarmEventId,
  };
}
