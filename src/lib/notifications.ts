/**
 * Notification queue + domain event helpers.
 *
 * Each domain helper resolves recipients and channels from the admin-editable
 * routing matrix (see lib/notificationSettings.ts), then:
 *   - queues a Notification row per WhatsApp / SMS recipient (status PENDING),
 *     drained by /api/cron/whatsapp-queue and /api/cron/sms-queue; and
 *   - sends Telegram inline (fire-and-forget) to linked recipients.
 *
 * A missing NotificationSetting row means "use the built-in default", so
 * behaviour matches the pre-panel app until an admin changes something.
 *
 * Return value convention (relied on by the crons): the number of QUEUED
 * WhatsApp/SMS rows. Telegram is inline and not counted. For deduped events a
 * Telegram-only send still drops a marker row so repeat sweeps skip.
 */
import { prisma } from "@/lib/db";
import type { NotificationKind, Prisma, UserRole } from "@prisma/client";
import { escapeHtml } from "@/lib/telegram";
import {
  formatDispatchAlert,
  sendTelegramToChatIds,
} from "@/lib/telegramNotify";
import { getNotificationRouting } from "@/lib/notificationSettings";

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

// ── Recipient resolution ───────────────────────────────────────────────────

type Contactable = {
  id: string;
  name: string;
  phone: string | null;
  whatsappNumber: string | null;
  telegramChatId: string | null;
};

const CONTACT_SELECT = {
  id: true,
  name: true,
  phone: true,
  whatsappNumber: true,
  telegramChatId: true,
} as const;

/** Active admins/dispatchers matching the given role flags. */
async function resolveStaff(flags: {
  admin: boolean;
  dispatcher: boolean;
}): Promise<Contactable[]> {
  const roles: UserRole[] = [];
  if (flags.admin) roles.push("ADMIN");
  if (flags.dispatcher) roles.push("DISPATCHER");
  if (roles.length === 0) return [];
  return prisma.user.findMany({
    where: { active: true, role: { in: roles } },
    select: CONTACT_SELECT,
  });
}

/** Active users by id (the officers involved in an event). */
async function resolveOfficers(ids: (string | null)[]): Promise<Contactable[]> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (uniq.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: uniq }, active: true },
    select: CONTACT_SELECT,
  });
}

function dedupById(people: Contactable[]): Contactable[] {
  const map = new Map<string, Contactable>();
  for (const p of people) map.set(p.id, p);
  return [...map.values()];
}

// ── Staff / dispatch events ────────────────────────────────────────────────

/**
 * Route a staff/dispatch event through the settings matrix. Sends Telegram
 * inline to linked recipients and queues WhatsApp/SMS rows for the rest.
 *
 * Returns the count of queued WhatsApp/SMS rows (Telegram excluded).
 *
 * `dedupe` — when true, sends at most once per (kind, entity): it skips if a
 * non-FAILED Notification already exists, and if the event fired on Telegram
 * only (nothing queued) it writes a TELEGRAM marker row so later sweeps skip.
 * Leave false for one-shot events whose callers already gate re-fires.
 */
async function dispatchToStaff(args: {
  kind: NotificationKind;
  bodyPreview: string;
  templateName: string;
  templateParams: string[];
  eventEntity: string;
  eventEntityId: string;
  officerIds?: (string | null)[];
  dedupe?: boolean;
}): Promise<number> {
  const r = await getNotificationRouting(args.kind);
  if (!r.enabled) return 0;

  if (args.dedupe) {
    const existing = await prisma.notification.findFirst({
      where: {
        kind: args.kind,
        eventEntity: args.eventEntity,
        eventEntityId: args.eventEntityId,
        status: { notIn: ["FAILED"] },
      },
      select: { id: true },
    });
    if (existing) return 0;
  }

  const staff = await resolveStaff({
    admin: r.toAdmin,
    dispatcher: r.toDispatcher,
  });
  const officers =
    r.toOfficer && args.officerIds?.length
      ? await resolveOfficers(args.officerIds)
      : [];
  const people = dedupById([...staff, ...officers]);

  // Telegram — inline, fire-and-forget, to whoever's linked.
  let telegramSent = 0;
  if (r.viaTelegram) {
    const chatIds = people
      .map((p) => p.telegramChatId)
      .filter((x): x is string => Boolean(x));
    if (chatIds.length > 0) {
      const res = await sendTelegramToChatIds(
        chatIds,
        formatDispatchAlert(args.kind, args.bodyPreview),
      ).catch(() => [] as { chatId: string; ok: boolean }[]);
      telegramSent = res.filter((x) => x.ok).length;
    }
  }

  // WhatsApp + SMS — queued for the per-minute drainers.
  const rows: Prisma.NotificationCreateManyInput[] = [];
  if (r.viaWhatsapp) {
    for (const p of people) {
      if (!p.whatsappNumber) continue;
      rows.push({
        kind: args.kind,
        channel: "WHATSAPP",
        recipientUserId: p.id,
        recipientNumber: p.whatsappNumber,
        templateName: args.templateName,
        templateParams: args.templateParams as unknown as Prisma.InputJsonValue,
        bodyPreview: args.bodyPreview,
        eventEntity: args.eventEntity,
        eventEntityId: args.eventEntityId,
      });
    }
  }
  if (r.viaSms) {
    for (const p of people) {
      if (!p.phone) continue;
      rows.push({
        kind: args.kind,
        channel: "SMS",
        recipientUserId: p.id,
        recipientNumber: p.phone,
        templateName: String(args.kind),
        templateParams: [] as unknown as Prisma.InputJsonValue,
        bodyText: args.bodyPreview,
        bodyPreview: args.bodyPreview.slice(0, 240),
        eventEntity: args.eventEntity,
        eventEntityId: args.eventEntityId,
      });
    }
  }

  let queued = 0;
  if (rows.length > 0) {
    queued = (await prisma.notification.createMany({ data: rows })).count;
  }

  // Telegram-only deduped event: leave a marker so later sweeps skip.
  if (args.dedupe && queued === 0 && r.viaTelegram) {
    await prisma.notification
      .create({
        data: {
          kind: args.kind,
          channel: "TELEGRAM",
          status: telegramSent > 0 ? "SENT" : "FAILED",
          sentAt: telegramSent > 0 ? new Date() : null,
          templateName: String(args.kind),
          bodyText: args.bodyPreview,
          bodyPreview: args.bodyPreview.slice(0, 240),
          eventEntity: args.eventEntity,
          eventEntityId: args.eventEntityId,
        },
      })
      .catch((e) => console.error("telegram dedup marker failed", e));
  }

  return queued;
}

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
  return dispatchToStaff({
    kind: "VISIT_STARTED",
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
  return dispatchToStaff({
    kind: "VISIT_COMPLETED",
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
  return dispatchToStaff({
    kind,
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
  return dispatchToStaff({
    kind: "ALARM_RECEIVED",
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
  return dispatchToStaff({
    kind: "SHIFT_CHECK_OVERDUE",
    templateName: "shift_check_overdue",
    templateParams: [officerName, siteLabel, expectedEvery],
    bodyPreview: `${officerName} at ${siteLabel} — hourly check overdue (expected every ${expectedEvery})`,
    eventEntity: "Shift",
    eventEntityId: shiftId,
  });
}

export async function notifyKeyHandover(movementId: string): Promise<number> {
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

  return dispatchToStaff({
    kind: "KEY_HANDOVER",
    templateName: "key_handover",
    templateParams: [keyLabel, fromLabel, toLabel, occurredAt],
    bodyPreview: `${keyLabel}: ${fromLabel} → ${toLabel} (${occurredAt})`,
    eventEntity: "KeyMovement",
    eventEntityId: movementId,
    // The officers who gave/received the key also get it, when toOfficer is on.
    officerIds: [movement.fromUserId, movement.toUserId],
  });
}

/**
 * Officer no-show on a shift/job. Sent to the office. Deduped per entity so the
 * 15-min sweep only alerts once; works whichever channels are enabled.
 */
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
    body = `1NW alert: ${j.assignedTo?.name ?? "officer"} not on site for ${j.type
      .replace(/_/g, " ")
      .toLowerCase()} at ${siteLabel} (scheduled ${fmt(j.scheduledFor)}).`;
  }
  return dispatchToStaff({
    kind: "OFFICER_NO_SHOW",
    templateName: "OFFICER_NO_SHOW",
    templateParams: [],
    bodyPreview: body,
    eventEntity: args.entity,
    eventEntityId: args.entityId,
    dedupe: true,
  });
}

/**
 * Missed inbound call → alert the office. Fires 24/7. Deduped per CallEvent so
 * repeated webhook deliveries don't re-alert.
 */
export async function notifyMissedCall(callEventId: string): Promise<number> {
  const call = await prisma.callEvent.findUnique({
    where: { id: callEventId },
    select: { id: true, fromNumber: true, toNumber: true, occurredAt: true },
  });
  if (!call) return 0;
  const from = call.fromNumber ?? "withheld / unknown number";
  const when = fmt(call.occurredAt ?? new Date());
  const line = call.toNumber ? ` (on ${call.toNumber})` : "";
  const body = `1NW: Missed call from ${from}${line} at ${when}. Please call back.`;
  return dispatchToStaff({
    kind: "MISSED_CALL",
    templateName: "MISSED_CALL",
    templateParams: [],
    bodyPreview: body,
    eventEntity: "CallEvent",
    eventEntityId: callEventId,
    dedupe: true,
  });
}

// ── Officer-targeted messages ──────────────────────────────────────────────

/**
 * Send a one-off message to a single officer over the channels enabled for
 * `kind`. Deduped per (kind, entity): sends at most once, whichever channel.
 * Returns queued SMS row count (Telegram inline, marker written if SMS off).
 */
async function dispatchToOfficer(args: {
  kind: NotificationKind;
  officer: { id: string; phone: string | null; telegramChatId: string | null };
  body: string;
  eventEntity: string;
  eventEntityId: string;
}): Promise<number> {
  const r = await getNotificationRouting(args.kind);
  if (!r.enabled || !r.toOfficer) return 0;

  const existing = await prisma.notification.findFirst({
    where: {
      kind: args.kind,
      eventEntity: args.eventEntity,
      eventEntityId: args.eventEntityId,
      status: { notIn: ["FAILED"] },
    },
    select: { id: true },
  });
  if (existing) return 0;

  let telegramOk = false;
  if (r.viaTelegram && args.officer.telegramChatId) {
    const res = await sendTelegramToChatIds(
      [args.officer.telegramChatId],
      `🔔 ${escapeHtml(args.body)}`,
    ).catch(() => [] as { chatId: string; ok: boolean }[]);
    telegramOk = res.some((x) => x.ok);
  }

  let queued = 0;
  if (r.viaSms && args.officer.phone) {
    const created = await prisma.notification.create({
      data: {
        kind: args.kind,
        channel: "SMS",
        recipientUserId: args.officer.id,
        recipientNumber: args.officer.phone,
        templateName: String(args.kind),
        templateParams: [] as unknown as Prisma.InputJsonValue,
        bodyText: args.body,
        bodyPreview: args.body.slice(0, 240),
        eventEntity: args.eventEntity,
        eventEntityId: args.eventEntityId,
      },
    });
    if (created) queued = 1;
  }

  // Telegram-only: write a marker so re-sweeps skip.
  if (queued === 0 && r.viaTelegram && args.officer.telegramChatId) {
    await prisma.notification
      .create({
        data: {
          kind: args.kind,
          channel: "TELEGRAM",
          status: telegramOk ? "SENT" : "FAILED",
          sentAt: telegramOk ? new Date() : null,
          recipientUserId: args.officer.id,
          recipientNumber: args.officer.telegramChatId,
          templateName: String(args.kind),
          bodyText: args.body,
          bodyPreview: args.body.slice(0, 240),
          eventEntity: args.eventEntity,
          eventEntityId: args.eventEntityId,
        },
      })
      .catch((e) => console.error("officer telegram marker failed", e));
  }

  return queued;
}

export async function notifyShiftReminder(shiftId: string): Promise<number> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      officer: {
        select: { id: true, name: true, phone: true, telegramChatId: true },
      },
      site: { select: { name: true, code: true, postcodeFormatted: true } },
    },
  });
  if (!shift?.officer) return 0;
  const siteLabel = shift.site
    ? `${shift.site.code ? shift.site.code + " " : ""}${shift.site.name}`
    : "site";
  const postcode = shift.site?.postcodeFormatted ?? "";
  const startsAt = fmt(shift.scheduledStartsAt);
  const typeLabel =
    shift.type === "STATIC_GUARDING" ? "Static guarding" : "Dog handler";
  const body = `1NW reminder: ${typeLabel} at ${siteLabel}${postcode ? `, ${postcode}` : ""} starts ${startsAt}.`;
  return dispatchToOfficer({
    kind: "SHIFT_REMINDER",
    officer: shift.officer,
    body,
    eventEntity: "Shift",
    eventEntityId: shiftId,
  });
}

export async function notifyJobReminder(jobId: string): Promise<number> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      assignedTo: {
        select: { id: true, name: true, phone: true, telegramChatId: true },
      },
      site: { select: { name: true, code: true, postcodeFormatted: true } },
    },
  });
  if (!job?.assignedTo || !job.scheduledFor) return 0;
  const siteLabel = job.site
    ? `${job.site.code ? job.site.code + " " : ""}${job.site.name}`
    : "site";
  const postcode = job.site?.postcodeFormatted ?? "";
  const startsAt = fmt(job.scheduledFor);
  const typeLabel = job.type.replace(/_/g, " ").toLowerCase();
  const body = `1NW reminder: ${typeLabel} at ${siteLabel}${postcode ? `, ${postcode}` : ""} scheduled ${startsAt}.`;
  return dispatchToOfficer({
    kind: "JOB_REMINDER",
    officer: job.assignedTo,
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
    select: {
      id: true,
      phone: true,
      telegramChatId: true,
      active: true,
    },
  });
  if (!officer?.active) return 0;
  const amount = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(args.totalPay);
  const body = `1NW pay summary for ${args.monthLabel}: ${args.activities} activities, ${amount} due. Statement on dashboard.`;
  return dispatchToOfficer({
    kind: "PAY_SUMMARY",
    officer,
    body,
    eventEntity: "User",
    eventEntityId: `${args.officerId}:${args.monthLabel}`,
  });
}

// ── Customer-targeted messages ─────────────────────────────────────────────

/**
 * Text a customer to acknowledge an alarm was attended. Only for customers who
 * opted in (smsAlertsOn) and have a contact number, and only when the
 * ALARM_CUSTOMER_ACK routing has SMS enabled. Deduped per Job.
 */
export async function notifyAlarmCustomerAck(jobId: string): Promise<number> {
  const r = await getNotificationRouting("ALARM_CUSTOMER_ACK");
  if (!r.enabled || !r.viaSms) return 0;

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

  const existing = await prisma.notification.findFirst({
    where: {
      kind: "ALARM_CUSTOMER_ACK",
      eventEntity: "Job",
      eventEntityId: jobId,
      status: { notIn: ["FAILED"] },
    },
    select: { id: true },
  });
  if (existing) return 0;

  const siteLabel = job.site?.code
    ? `${job.site.code} ${job.site.name}`
    : job.site?.name ?? "site";
  const arrived = fmt(job.startedAt ?? job.completedAt ?? new Date());
  const body = `1NW: Alarm response at ${siteLabel}. Officer attended ${arrived}. Site secure.`;
  await prisma.notification.create({
    data: {
      kind: "ALARM_CUSTOMER_ACK",
      channel: "SMS",
      recipientUserId: null,
      recipientNumber: job.customer.contactPhone,
      templateName: "ALARM_CUSTOMER_ACK",
      templateParams: [] as unknown as Prisma.InputJsonValue,
      bodyText: body,
      bodyPreview: body.slice(0, 240),
      eventEntity: "Job",
      eventEntityId: jobId,
    },
  });
  return 1;
}

// ── Queue drainer ──────────────────────────────────────────────────────────

import { isWhatsAppConfigured, sendTemplate } from "@/lib/whatsapp";
import { isSmsConfigured, sendSms } from "@/lib/sms";

export type DrainResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Generic drainer — `channel` decides which provider runs. The two crons
 * (`/api/cron/whatsapp-queue`, `/api/cron/sms-queue`) each pass their own
 * channel so retries don't bleed between providers. TELEGRAM rows are written
 * already-sent (inline) and are never drained here.
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
              : "SMS not configured (HTTPSMS_API_KEY / HTTPSMS_FROM missing)",
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
    let res: { ok: true; messageId: string } | { ok: false; error: string };
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
