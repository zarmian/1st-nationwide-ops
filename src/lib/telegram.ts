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

/**
 * Point Telegram at our webhook. One-time setup (or after the URL/secret
 * changes). Uses the same TELEGRAM_WEBHOOK_SECRET the webhook checks, so
 * Telegram echoes it back in every update. Returns a flat ok/error.
 */
export async function setWebhook(
  url: string,
  secret: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await call("setWebhook", {
    url,
    secret_token: secret,
    // Drop any updates queued while the webhook was unset/misconfigured.
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
  });
  return res?.ok
    ? { ok: true }
    : { ok: false, error: res?.description ?? res?.error ?? "Telegram rejected the request" };
}

/** Read back Telegram's current webhook registration (for a status check). */
export async function getWebhookInfo(): Promise<{
  ok: boolean;
  url?: string;
  pendingUpdateCount?: number;
  lastErrorMessage?: string;
  error?: string;
}> {
  const res = await call("getWebhookInfo", {});
  if (!res?.ok) {
    return { ok: false, error: res?.description ?? res?.error ?? "unknown" };
  }
  return {
    ok: true,
    url: res.result?.url || "",
    pendingUpdateCount: res.result?.pending_update_count,
    lastErrorMessage: res.result?.last_error_message,
  };
}

/**
 * The public URL Telegram should POST updates to. Derived from NEXTAUTH_URL
 * (already set to the live origin) so we never hardcode the deploy domain.
 */
export function webhookUrl(): string | null {
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  return base ? `${base}/api/telegram/webhook` : null;
}

/** Escape user-supplied text for HTML parse mode. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
