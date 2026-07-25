/**
 * Telegram Bot API client — thin REST wrapper, no SDK.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN     — from @BotFather. Required to send/receive.
 *   TELEGRAM_BOT_USERNAME  — the bot's @username (without @), for deep links.
 *   TELEGRAM_WEBHOOK_SECRET — set on the webhook; Telegram echoes it back in
 *                            the X-Telegram-Bot-Api-Secret-Token header.
 *
 * Everything is free (no per-message cost). To message a user they must have
 * started the bot first, so we store their chat id at link time.
 */

const API = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

export type InlineButton = { text: string; callback_data: string };

async function call(method: string, body: Record<string, unknown>): Promise<any> {
  const token = botToken();
  if (!token) return { ok: false, error: "Telegram not configured" };
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json().catch(() => ({ ok: false }));
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network" };
  }
}

/** Send an HTML message, optionally with a grid of inline buttons. */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][],
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const res = await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  return res?.ok
    ? { ok: true, messageId: res.result?.message_id }
    : { ok: false, error: res?.description ?? res?.error };
}

/** Replace an existing message's text + buttons (e.g. after a button tap). */
export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Acknowledge a button tap so Telegram stops the spinner. */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

/** The bot's @username → for building t.me deep links. */
export function botUsername(): string | null {
  return process.env.TELEGRAM_BOT_USERNAME ?? null;
}

/** Escape user-supplied text for HTML parse mode. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
