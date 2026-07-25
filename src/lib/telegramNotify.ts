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
