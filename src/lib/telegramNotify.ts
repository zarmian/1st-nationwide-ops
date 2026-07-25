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
  lines.push("", "Open the app for full details.");

  await sendTelegramMessage(chatId, lines.join("\n"));
}

// ── Dispatch broadcasts (missed calls, no-shows, overdue check-ins) ─────────
//
// These DM every linked ADMIN/DISPATCHER. Dedupe is the caller's job — each
// is fired from a point that already gates (the CallEvent.alerted flag, or
// the shift-checks cron's per-window checks) so the same alert goes once.

/** DM every linked staff member. Returns how many were reached. */
async function broadcastToLinkedStaff(text: string): Promise<number> {
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

/** Overdue shift check-in → alert dispatch on Telegram. */
export async function alertShiftCheckOverdueTelegram(
  shiftId: string,
): Promise<number> {
  const s = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      checkIntervalMin: true,
      site: { select: { name: true } },
      officer: { select: { name: true } },
    },
  });
  if (!s) return 0;
  return broadcastToLinkedStaff(
    `⚠️ <b>Check-in overdue</b>\n${escapeHtml(s.officer?.name ?? "Officer")} at ${escapeHtml(s.site?.name ?? "site")} — no check-in (expected every ${s.checkIntervalMin} min).`,
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
