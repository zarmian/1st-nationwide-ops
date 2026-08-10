/**
 * Outbound Telegram alerts tied to app events. Kept separate from
 * lib/telegram (the pure Bot API wrapper) because these touch the DB.
 *
 * Every function here is fire-and-forget and self-guarding: a no-op when
 * Telegram isn't configured or the target hasn't linked their chat, so
 * callers can `.catch(() => {})` without branching.
 */
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import {
  escapeHtml,
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/telegram";
import { jobActionData } from "@/lib/telegramCallout";

const JOB_TYPE_LABELS: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static guarding",
  DOG_HANDLER_SHIFT: "Dog handler",
};

/**
 * DM the officer a job is assigned to, if they've linked Telegram. Safe to
 * call after any assignment (create or reassign) — it silently does nothing
 * when there's no assignee, no linked chat, or the bot isn't configured.
 */
export async function notifyAssignedOfficerOfJob(jobId: string): Promise<void> {
  if (!isTelegramConfigured()) return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      type: true,
      typeLabel: true,
      scheduledFor: true,
      notes: true,
      site: { select: { name: true } },
      assignedTo: { select: { telegramChatId: true } },
    },
  });
  const chatId = job?.assignedTo?.telegramChatId;
  if (!job || !chatId) return;

  const typeText =
    job.typeLabel?.trim() || JOB_TYPE_LABELS[job.type] || job.type;
  const when = job.scheduledFor ? formatDateTime(job.scheduledFor) : "now";

  const lines = [
    "🔔 <b>New callout assigned to you</b>",
    "",
    `Site: ${escapeHtml(job.site?.name ?? "—")}`,
    `Type: ${escapeHtml(typeText)}`,
    `When: ${escapeHtml(when)}`,
  ];
  if (job.notes) lines.push(`Notes: ${escapeHtml(job.notes)}`);
  lines.push("", "Tap below when you're on site / done, or open the app.");

  await sendTelegramMessage(chatId, lines.join("\n"), [
    [
      { text: "✅ On site", callback_data: jobActionData("onsite", jobId) },
      { text: "🏁 Complete", callback_data: jobActionData("complete", jobId) },
    ],
  ]);
}

// ── Dispatch broadcasts (missed calls, no-shows, domain events) ─────────────
//
// These DM every linked ADMIN/DISPATCHER. Dedupe is the caller's job — each
// is fired from a point that already gates (the CallEvent.alerted flag, the
// shift-checks cron's per-window checks, or a status flip) so the same alert
// goes once.

/** DM every linked staff member. Returns how many were reached. */
export async function broadcastToLinkedStaff(text: string): Promise<number> {
  if (!isTelegramConfigured()) return 0;
  const staff = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["ADMIN", "DISPATCHER"] },
      NOT: { telegramChatId: null },
    },
    select: { telegramChatId: true },
  });
  let sent = 0;
  await Promise.all(
    staff.map(async (s) => {
      if (!s.telegramChatId) return;
      const r = await sendTelegramMessage(s.telegramChatId, text).catch(() => ({
        ok: false as const,
      }));
      if (r.ok) sent += 1;
    }),
  );
  return sent;
}

/**
 * Emoji + heading for each domain event, so the Telegram broadcast reads at a
 * glance. Keyed by NotificationKind; anything unmapped falls back to a bell.
 */
const DISPATCH_ALERT_META: Record<string, { emoji: string; title: string }> = {
  VISIT_STARTED: { emoji: "🟢", title: "Patrol started" },
  VISIT_COMPLETED: { emoji: "✅", title: "Patrol completed" },
  VISIT_LATE: { emoji: "🟠", title: "Patrol running late" },
  VISIT_MISSED: { emoji: "🔴", title: "Patrol missed" },
  ALARM_RECEIVED: { emoji: "🚨", title: "Alarm received" },
  SHIFT_CHECK_OVERDUE: { emoji: "⚠️", title: "Check-in overdue" },
  KEY_HANDOVER: { emoji: "🔑", title: "Key handover" },
};

/**
 * Broadcast a domain event to every linked dispatcher/admin on Telegram.
 * The single Telegram funnel for everything that used to be WhatsApp-only —
 * called from lib/notifications' queueAll so each event reaches Telegram
 * regardless of whether any WhatsApp recipients are configured. `body` is the
 * same human-readable line the WhatsApp queue stores as bodyPreview.
 */
export async function notifyDispatchTelegram(
  kind: string,
  body: string,
): Promise<number> {
  if (!isTelegramConfigured()) return 0;
  const meta = DISPATCH_ALERT_META[kind] ?? { emoji: "🔔", title: "Update" };
  const text = `${meta.emoji} <b>${meta.title}</b>\n${escapeHtml(body)}`;
  return broadcastToLinkedStaff(text);
}

/** Missed inbound call → alert dispatch on Telegram. */
export async function alertMissedCallTelegram(
  callEventId: string,
): Promise<number> {
  const call = await prisma.callEvent.findUnique({
    where: { id: callEventId },
    select: { fromNumber: true, toNumber: true, occurredAt: true },
  });
  if (!call) return 0;
  const from = call.fromNumber ?? "withheld / unknown number";
  const when = call.occurredAt ? formatDateTime(call.occurredAt) : "just now";
  const onLine = call.toNumber ? ` on ${escapeHtml(call.toNumber)}` : "";
  return broadcastToLinkedStaff(
    `📞 <b>Missed call</b>\nFrom ${escapeHtml(from)}${onLine}\n${escapeHtml(when)} — please call back.`,
  );
}

/** Officer no-show on a shift/job → alert dispatch on Telegram. */
export async function alertNoShowTelegram(
  entity: "Shift" | "Job",
  entityId: string,
): Promise<number> {
  if (entity === "Shift") {
    const s = await prisma.shift.findUnique({
      where: { id: entityId },
      select: {
        type: true,
        scheduledStartsAt: true,
        site: { select: { name: true } },
        officer: { select: { name: true } },
      },
    });
    if (!s) return 0;
    const kind = s.type === "STATIC_GUARDING" ? "static" : "dog";
    return broadcastToLinkedStaff(
      `🔴 <b>No-show</b>\n${escapeHtml(s.officer?.name ?? "Officer")} hasn't started the ${kind} shift at ${escapeHtml(s.site?.name ?? "site")} (scheduled ${escapeHtml(formatDateTime(s.scheduledStartsAt))}).`,
    );
  }
  const j = await prisma.job.findUnique({
    where: { id: entityId },
    select: {
      type: true,
      scheduledFor: true,
      site: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });
  if (!j) return 0;
  const what = JOB_TYPE_LABELS[j.type] || j.type.replace(/_/g, " ").toLowerCase();
  const when = j.scheduledFor ? formatDateTime(j.scheduledFor) : "—";
  return broadcastToLinkedStaff(
    `🔴 <b>No-show</b>\n${escapeHtml(j.assignedTo?.name ?? "Officer")} not on site for ${escapeHtml(what)} at ${escapeHtml(j.site?.name ?? "site")} (scheduled ${escapeHtml(when)}).`,
  );
}

/**
 * Chase reminder for a job we've handed to a partner (e.g. Nexus). Their
 * officer fills in the partner's own app, so we never get an automatic
 * completion — dispatch has to pull a status. Broadcast to every linked
 * dispatcher/admin; the shift-checks cron re-sends every 15 min until the job
 * is closed / cancelled, or its partner report reference is logged.
 */
export async function alertPartnerUpdateDueTelegram(
  jobId: string,
): Promise<number> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      type: true,
      typeLabel: true,
      scheduledFor: true,
      handedOffAt: true,
      externalResponder: true,
      site: { select: { name: true, code: true } },
      handledByPartner: { select: { name: true } },
    },
  });
  if (!job) return 0;
  const partner = job.handledByPartner?.name ?? "the partner";
  const siteLabel = job.site
    ? `${job.site.code ? job.site.code + " · " : ""}${job.site.name}`
    : "site";
  const what =
    job.typeLabel ??
    JOB_TYPE_LABELS[job.type] ??
    job.type.replace(/_/g, " ").toLowerCase();
  const since = job.handedOffAt ?? job.scheduledFor;
  const sinceBit = since ? ` — passed over ${formatDateTime(since)}` : "";
  const theirOfficer = job.externalResponder
    ? `\nTheir officer: ${escapeHtml(job.externalResponder)}`
    : "";
  return broadcastToLinkedStaff(
    `📞 <b>Chase ${escapeHtml(partner)} for an update</b>\n${escapeHtml(what)} at ${escapeHtml(siteLabel)}${escapeHtml(sinceBit)}.${theirOfficer}\nNo outcome logged yet — get a status and close the job once confirmed.`,
  );
}
