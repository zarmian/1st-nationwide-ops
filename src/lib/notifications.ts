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

// ── Queue drainer ────────────────────────────────────────────────────────

import { isWhatsAppConfigured, sendTemplate } from "@/lib/whatsapp";

export type DrainResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
};

export async function drainQueue(maxBatch = 50): Promise<DrainResult> {
  const pending = await prisma.notification.findMany({
    where: { status: "PENDING", channel: "WHATSAPP" },
    orderBy: { createdAt: "asc" },
    take: maxBatch,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  if (!isWhatsAppConfigured()) {
    // Mark all pending as skipped so they don't pile up forever once the
    // admin sees the queue and decides what to do. Reason is plain so the
    // UI surfaces it.
    if (pending.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: {
          status: "SKIPPED",
          error: "WhatsApp not configured (WHATSAPP_PHONE_ID / WHATSAPP_ACCESS_TOKEN missing)",
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
    const params = Array.isArray(n.templateParams)
      ? (n.templateParams as unknown[]).map(String)
      : [];
    const res = await sendTemplate({
      to: n.recipientNumber,
      templateName: n.templateName,
      bodyParams: params,
    });
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
