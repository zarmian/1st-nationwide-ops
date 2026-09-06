/**
 * Notification queue + domain event helpers.
 *
 * Each domain helper resolves recipients and writes one Notification row per
 * recipient with status PENDING. The /api/cron/whatsapp-queue cron drains the
 * queue.
 *
 * Recipient rules (Phase 1, internal-only — events 1-4 + 7 from spec):
 *   - VISIT_STARTED, VISIT_COMPLETED, VISIT_LATE, VISIT_MISSED, ALARM_RECEIVED
 *       → all active staff (ADMIN + DISPATCHER) who have a whatsappNumber set
 *   - KEY_HANDOVER
 *       → all active staff + the from/to officer of the movement
 *
 * Template names mirror what you'll submit for approval in Meta Business
 * (see docs/whatsapp-setup.md).
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { notifyDispatchTelegram } from "@/lib/telegramNotify";

const TZ = "Europe/London";

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function staffRecipients(): Promise<
  { id: string; name: string; whatsappNumber: string }[]
> {
  const rows = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["ADMIN", "DISPATCHER"] },
      NOT: { whatsappNumber: null },
    },
    select: { id: true, name: true, whatsappNumber: true },
  });
  return rows.filter(
    (r): r is { id: string; name: string; whatsappNumber: string } =>
      typeof r.whatsappNumber === "string" && r.whatsappNumber.length > 0,
  );
}

async function officerRecipient(
  userId: string | null,
): Promise<{ id: string; name: string; whatsappNumber: string } | null> {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, whatsappNumber: true, active: true },
  });
  if (!u || !u.active || !u.whatsappNumber) return null;
  return { id: u.id, name: u.name, whatsappNumber: u.whatsappNumber };
}

type QueueArgs = {
  kind: Prisma.NotificationCreateInput["kind"];
  recipients: { id: string; name: string; whatsappNumber: string }[];
  templateName: string;
  templateParams: string[];
  bodyPreview: string;
  eventEntity: string;
  eventEntityId: string;
};

async function queueAll(args: QueueArgs): Promise<number> {
  // Mirror every WhatsApp-planned event to all linked dispatch on Telegram,
  // whether or not any WhatsApp recipients are configured. Fire-and-forget so
  // a Telegram hiccup never blocks the queue write.
  notifyDispatchTelegram(args.kind, args.bodyPreview).catch((e) =>
    console.error("notifyDispatchTelegram failed", e),
  );
  if (args.recipients.length === 0) return 0;
  const data = args.recipients.map((r) => ({
    kind: args.kind,
    channel: "WHATSAPP" as const,
    recipientUserId: r.id,
    recipientNumber: r.whatsappNumber,
    templateName: args.templateName,
    templateParams: args.templateParams as any,
    bodyPreview: args.bodyPreview,
    eventEntity: args.eventEntity,
    eventEntityId: args.eventEntityId,
  }));
  const result = await prisma.notification.createMany({ data });
  return result.count;
}

// ── Domain events ────────────────────────────────────────────────────────

export async function notifyVisitStarted(visitId: string): Promise<number> {
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    include: {
      site: { select: { name: true, code: true } },
      officer: { select: { name: true } },
    },
  });
  if (!visit) return 0;
  const officerName = visit.officer?.name ?? "Officer";
  const siteLabel = visit.site
    ? `${visit.site.code ? visit.site.code + " · " : ""}${visit.site.name}`
    : "site";
  const arrivedAt = fmt(visit.arrivedAt ?? new Date());
  return queueAll({
    kind: "VISIT_STARTED",
    recipients: await staffRecipients(),
    templateName: "visit_started",
    templateParams: [officerName, siteLabel, arrivedAt],
    bodyPreview: `${officerName} on site at ${siteLabel} (${arrivedAt})`,
    eventEntity: "PatrolVisit",
    eventEntityId: visitId,
  });
}

export async function notifyVisitCompleted(visitId: string): Promise<number> {
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    include: {
      site: { select: { name: true, code: true } },
      officer: { select: { name: true } },
    },
  });
  if (!visit) return 0;
  const officerName = visit.officer?.name ?? "Officer";
  const siteLabel = visit.site
    ? `${visit.site.code ? visit.site.code + " · " : ""}${visit.site.name}`
    : "site";
  const departedAt = fmt(visit.departedAt ?? new Date());
  return queueAll({
    kind: "VISIT_COMPLETED",
    recipients: await staffRecipients(),
    templateName: "visit_completed",
    templateParams: [siteLabel, officerName, departedAt],
    bodyPreview: `Patrol of ${siteLabel} completed by ${officerName} at ${departedAt}`,
    eventEntity: "PatrolVisit",
    eventEntityId: visitId,
  });
}

export async function notifyVisitLateOrMissed(
  visitId: string,
  status: "LATE" | "MISSED",
): Promise<number> {
  const visit = await prisma.patrolVisit.findUnique({
    where: { id: visitId },
    include: {
      site: { select: { name: true, code: true } },
      officer: { select: { name: true } },
    },
  });
  if (!visit) return 0;
  const officerName = visit.officer?.name ?? "unassigned";
  const siteLabel = visit.site
    ? `${visit.site.code ? visit.site.code + " · " : ""}${visit.site.name}`
    : "site";
  const scheduledAt = fmt(visit.scheduledAt);
  const kind: "VISIT_LATE" | "VISIT_MISSED" =
    status === "LATE" ? "VISIT_LATE" : "VISIT_MISSED";
  const verb = status === "LATE" ? "is late" : "was MISSED";
  return queueAll({
    kind,
    recipients: await staffRecipients(),
    templateName: status === "LATE" ? "visit_late" : "visit_missed",
    templateParams: [siteLabel, officerName, scheduledAt],
    bodyPreview: `Visit to ${siteLabel} ${verb} (assigned: ${officerName}, scheduled ${scheduledAt})`,
    eventEntity: "PatrolVisit",
    eventEntityId: visitId,
  });
}

export async function notifyAlarmReceived(
  alarmEventId: string,
): Promise<number> {
  const alarm = await prisma.alarmEvent.findUnique({
    where: { id: alarmEventId },
    include: { site: { select: { name: true, code: true } } },
  });
  if (!alarm) return 0;
  const siteLabel = alarm.site
    ? `${alarm.site.code ? alarm.site.code + " · " : ""}${alarm.site.name}`
    : "site";
  const receivedAt = fmt(alarm.receivedAt);
  const priority = alarm.priority;
  return queueAll({
    kind: "ALARM_RECEIVED",
    recipients: await staffRecipients(),
    templateName: "alarm_received",
    templateParams: [siteLabel, priority, receivedAt],
    bodyPreview: `ALARM at ${siteLabel} — ${priority}, received ${receivedAt}`,
    eventEntity: "AlarmEvent",
    eventEntityId: alarmEventId,
  });
}

export async function notifyShiftCheckOverdue(
  shiftId: string,
): Promise<number> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      site: { select: { name: true, code: true } },
      officer: { select: { name: true } },
    },
  });
  if (!shift) return 0;
  const officerName = shift.officer?.name ?? "Officer";
  const siteLabel = shift.site
    ? `${shift.site.code ? shift.site.code + " · " : ""}${shift.site.name}`
    : "site";
  const expectedEvery = `${shift.checkIntervalMin} min`;
  return queueAll({
    kind: "SHIFT_CHECK_OVERDUE",
    recipients: await staffRecipients(),
    templateName: "shift_check_overdue",
    templateParams: [officerName, siteLabel, expectedEvery],
    bodyPreview: `${officerName} at ${siteLabel} — hourly check overdue (expected every ${expectedEvery})`,
    eventEntity: "Shift",
    eventEntityId: shiftId,
  });
}

export async function notifyKeyHandover(
  movementId: string,
): Promise<number> {
  const movement = await prisma.keyMovement.findUnique({
    where: { id: movementId },
    include: {
      key: { select: { label: true, internalNo: true } },
      fromUser: { select: { id: true, name: true } },
      toUser: { select: { id: true, name: true } },
    },
  });
  if (!movement) return 0;
  const keyLabel = movement.key.internalNo
    ? `${movement.key.internalNo} (${movement.key.label})`
    : movement.key.label;
  const fromLabel = movement.fromUser?.name ?? "1NW";
  const toLabel = movement.toUser?.name ?? "1NW";
  const occurredAt = fmt(movement.occurredAt);

  // Recipients: staff + the involved officers (deduped).
  const staff = await staffRecipients();
  const fromOfficer = await officerRecipient(movement.fromUserId);
  const toOfficer = await officerRecipient(movement.toUserId);
  const dedup = new Map<string, { id: string; name: string; whatsappNumber: string }>();
  for (const r of staff) dedup.set(r.id, r);
  if (fromOfficer) dedup.set(fromOfficer.id, fromOfficer);
  if (toOfficer) dedup.set(toOfficer.id, toOfficer);

  return queueAll({
    kind: "KEY_HANDOVER",
    recipients: Array.from(dedup.values()),
    templateName: "key_handover",
    templateParams: [keyLabel, fromLabel, toLabel, occurredAt],
    bodyPreview: `${keyLabel}: ${fromLabel} → ${toLabel} (${occurredAt})`,
    eventEntity: "KeyMovement",
    eventEntityId: movementId,
  });
}

// ── SMS domain events ────────────────────────────────────────────────────
//
// Each helper resolves the recipient, builds a plain-text body, and
// queues a Notification row with channel=SMS. The cron at
// /api/cron/sms-queue picks them up and sends via SMS Works.
//
// All helpers are idempotent at the entity-id level via Notification's
// eventEntityId index — callers check for an existing row before
// queueing, or use queueSmsOnce below.

type SmsRecipient = { userId?: string | null; number: string };

async function queueSms(args: {
  kind: Prisma.NotificationCreateInput["kind"];
  recipients: SmsRecipient[];
  body: string;
  eventEntity: string;
  eventEntityId: string;
}): Promise<number> {
  if (args.recipients.length === 0) return 0;
  const data = args.recipients.map((r) => ({
    kind: args.kind,
    channel: "SMS" as const,
    recipientUserId: r.userId ?? null,
    recipientNumber: r.number,
    templateName: args.kind, // SMS doesn't use templates; store the kind for traceability
    templateParams: [] as any,
    bodyText: args.body,
    bodyPreview: args.body.slice(0, 240),
    eventEntity: args.eventEntity,
    eventEntityId: args.eventEntityId,
  }));
  const result = await prisma.notification.createMany({ data });
  return result.count;
}

/**
 * De-duped queue. Skips if a Notification of the same kind already
 * exists for this entity. Use this for cron-driven reminders that
 * shouldn't re-fire on the next sweep.
 */
async function queueSmsOnce(args: {
  kind: Prisma.NotificationCreateInput["kind"];
  recipients: SmsRecipient[];
  body: string;
  eventEntity: string;
  eventEntityId: string;
}): Promise<number> {
  const existing = await prisma.notification.findFirst({
    where: {
      channel: "SMS",
      kind: args.kind,
      eventEntity: args.eventEntity,
      eventEntityId: args.eventEntityId,
      status: { notIn: ["FAILED"] },
    },
    select: { id: true },
  });
  if (existing) return 0;
  return queueSms(args);
}

async function dispatcherSmsRecipients(): Promise<SmsRecipient[]> {
  const rows = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["ADMIN", "DISPATCHER"] },
      NOT: { phone: null },
    },
    select: { id: true, name: true, phone: true },
  });
  return rows
    .filter((r): r is { id: string; name: string; phone: string } =>
      typeof r.phone === "string" && r.phone.length > 0,
    )
    .map((r) => ({ userId: r.id, number: r.phone }));
}

export async function notifyShiftReminder(shiftId: string): Promise<number> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      officer: { select: { id: true, name: true, phone: true } },
      site: { select: { name: true, code: true, postcodeFormatted: true } },
    },
  });
  if (!shift?.officer?.phone) return 0;
  const siteLabel = shift.site
    ? `${shift.site.code ? shift.site.code + " " : ""}${shift.site.name}`
    : "site";
  const postcode = shift.site?.postcodeFormatted ?? "";
  const startsAt = fmt(shift.scheduledStartsAt);
  const typeLabel =
    shift.type === "STATIC_GUARDING" ? "Static guarding" : "Dog handler";
  const body = `1NW reminder: ${typeLabel} at ${siteLabel}${postcode ? `, ${postcode}` : ""} starts ${startsAt}.`;
  return queueSmsOnce({
    kind: "SHIFT_REMINDER",
    recipients: [{ userId: shift.officer.id, number: shift.officer.phone }],
    body,
    eventEntity: "Shift",
    eventEntityId: shiftId,
  });
}

export async function notifyJobReminder(jobId: string): Promise<number> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      assignedTo: { select: { id: true, name: true, phone: true } },
      site: { select: { name: true, code: true, postcodeFormatted: true } },
    },
  });
  if (!job?.assignedTo?.phone || !job.scheduledFor) return 0;
  const siteLabel = job.site
    ? `${job.site.code ? job.site.code + " " : ""}${job.site.name}`
    : "site";
  const postcode = job.site?.postcodeFormatted ?? "";
  const startsAt = fmt(job.scheduledFor);
  const typeLabel = job.type.replace(/_/g, " ").toLowerCase();
  const body = `1NW reminder: ${typeLabel} at ${siteLabel}${postcode ? `, ${postcode}` : ""} scheduled ${startsAt}.`;
  return queueSmsOnce({
    kind: "JOB_REMINDER",
    recipients: [{ userId: job.assignedTo.id, number: job.assignedTo.phone }],
    body,
    eventEntity: "Job",
    eventEntityId: jobId,
  });
}

export async function notifyOfficerNoShow(args: {
  entity: "Shift" | "Job";
  entityId: string;
}): Promise<number> {
  let body = "";
  if (args.entity === "Shift") {
    const s = await prisma.shift.findUnique({
      where: { id: args.entityId },
      include: {
        officer: { select: { name: true } },
        site: { select: { name: true, code: true } },
      },
    });
    if (!s) return 0;
    const siteLabel = s.site?.code
      ? `${s.site.code} ${s.site.name}`
      : s.site?.name ?? "site";
    body = `1NW alert: ${s.officer?.name ?? "officer"} hasn't started ${
      s.type === "STATIC_GUARDING" ? "static" : "dog"
    } shift at ${siteLabel} (scheduled ${fmt(s.scheduledStartsAt)}).`;
  } else {
    const j = await prisma.job.findUnique({
      where: { id: args.entityId },
      include: {
        assignedTo: { select: { name: true } },
        site: { select: { name: true, code: true } },
      },
    });
    if (!j) return 0;
    const siteLabel = j.site?.code
      ? `${j.site.code} ${j.site.name}`
      : j.site?.name ?? "site";
    body = `1NW alert: ${j.assignedTo?.name ?? "officer"} not on site for ${j.type.replace(/_/g, " ").toLowerCase()} at ${siteLabel} (scheduled ${fmt(j.scheduledFor)}).`;
  }
  return queueSmsOnce({
    kind: "OFFICER_NO_SHOW",
    recipients: await dispatcherSmsRecipients(),
    body,
    eventEntity: args.entity,
    eventEntityId: args.entityId,
  });
}

export async function notifyAlarmCustomerAck(jobId: string): Promise<number> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      site: { select: { name: true, code: true } },
      customer: {
        select: {
          id: true,
          name: true,
          contactPhone: true,
          smsAlertsOn: true,
        },
      },
    },
  });
  if (!job?.customer?.smsAlertsOn) return 0;
  if (!job.customer.contactPhone) return 0;
  const siteLabel = job.site?.code
    ? `${job.site.code} ${job.site.name}`
    : job.site?.name ?? "site";
  const arrived = fmt(job.startedAt ?? job.completedAt ?? new Date());
  const body = `1NW: Alarm response at ${siteLabel}. Officer attended ${arrived}. Site secure.`;
  return queueSmsOnce({
    kind: "ALARM_CUSTOMER_ACK",
    recipients: [{ userId: null, number: job.customer.contactPhone }],
    body,
    eventEntity: "Job",
    eventEntityId: jobId,
  });
}

export async function notifyOfficerPaySummary(args: {
  officerId: string;
  monthLabel: string;
  activities: number;
  totalPay: number;
}): Promise<number> {
  const officer = await prisma.user.findUnique({
    where: { id: args.officerId },
    select: { phone: true, active: true },
  });
  if (!officer?.active || !officer.phone) return 0;
  const amount = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(args.totalPay);
  const body = `1NW pay summary for ${args.monthLabel}: ${args.activities} activities, ${amount} due. Statement on dashboard.`;
  return queueSmsOnce({
    kind: "PAY_SUMMARY",
    recipients: [{ userId: args.officerId, number: officer.phone }],
    body,
    eventEntity: "User",
    eventEntityId: `${args.officerId}:${args.monthLabel}`,
  });
}

/**
 * Alert dispatch / on-call staff that a call was missed. Fires 24/7. Deduped
 * per CallEvent so repeated webhook deliveries don't re-text the team.
 */
export async function notifyMissedCall(callEventId: string): Promise<number> {
  const call = await prisma.callEvent.findUnique({
    where: { id: callEventId },
    select: {
      id: true,
      fromNumber: true,
      toNumber: true,
      occurredAt: true,
    },
  });
  if (!call) return 0;
  const from = call.fromNumber ?? "withheld / unknown number";
  const when = fmt(call.occurredAt ?? new Date());
  const line = call.toNumber ? ` (on ${call.toNumber})` : "";
  const body = `1NW: Missed call from ${from}${line} at ${when}. Please call back.`;
  return queueSmsOnce({
    kind: "MISSED_CALL",
    recipients: await dispatcherSmsRecipients(),
    body,
    eventEntity: "CallEvent",
    eventEntityId: callEventId,
  });
}

// ── Queue drainer ────────────────────────────────────────────────────────

import { isWhatsAppConfigured, sendTemplate } from "@/lib/whatsapp";
import { isSmsConfigured, sendSms } from "@/lib/sms";

export type DrainResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Generic drainer — `channel` decides which provider runs. The two
 * crons (`/api/cron/whatsapp-queue`, `/api/cron/sms-queue`) each pass
 * their own channel so retries don't bleed between providers.
 */
export async function drainQueue(
  channel: "WHATSAPP" | "SMS" = "WHATSAPP",
  maxBatch = 50,
): Promise<DrainResult> {
  const pending = await prisma.notification.findMany({
    where: { status: "PENDING", channel },
    orderBy: { createdAt: "asc" },
    take: maxBatch,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const configured =
    channel === "WHATSAPP" ? isWhatsAppConfigured() : isSmsConfigured();
  if (!configured) {
    if (pending.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: {
          status: "SKIPPED",
          error:
            channel === "WHATSAPP"
              ? "WhatsApp not configured (WHATSAPP_PHONE_ID / WHATSAPP_ACCESS_TOKEN missing)"
              : "SMS not configured (no httpsms or SMS Works credentials)",
          attempts: { increment: 1 },
        },
      });
      skipped = pending.length;
    }
    return { scanned: pending.length, sent, failed, skipped };
  }

  for (const n of pending) {
    if (!n.recipientNumber) {
      await prisma.notification.update({
        where: { id: n.id },
        data: {
          status: "SKIPPED",
          error: "No recipient number",
          attempts: { increment: 1 },
        },
      });
      skipped++;
      continue;
    }
    let res:
      | { ok: true; messageId: string }
      | { ok: false; error: string };
    if (channel === "WHATSAPP") {
      const params = Array.isArray(n.templateParams)
        ? (n.templateParams as unknown[]).map(String)
        : [];
      res = await sendTemplate({
        to: n.recipientNumber,
        templateName: n.templateName,
        bodyParams: params,
      });
    } else {
      const body = n.bodyText ?? n.bodyPreview ?? "";
      if (!body) {
        await prisma.notification.update({
          where: { id: n.id },
          data: {
            status: "SKIPPED",
            error: "No body text",
            attempts: { increment: 1 },
          },
        });
        skipped++;
        continue;
      }
      res = await sendSms({ to: n.recipientNumber, body });
    }
    if (res.ok) {
      await prisma.notification.update({
        where: { id: n.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: { increment: 1 },
          error: null,
        },
      });
      sent++;
    } else {
      await prisma.notification.update({
        where: { id: n.id },
        data: {
          status: "FAILED",
          error: res.error.slice(0, 1000),
          attempts: { increment: 1 },
        },
      });
      failed++;
    }
  }

  return { scanned: pending.length, sent, failed, skipped };
}
