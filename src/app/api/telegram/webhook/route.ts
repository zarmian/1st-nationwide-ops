import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  answerCallbackQuery,
  escapeHtml,
  sendTelegramMessage,
} from "@/lib/telegram";

/**
 * Telegram bot webhook. Telegram POSTs every update here.
 *
 * Security: the webhook is registered with a secret_token, which Telegram
 * echoes in the X-Telegram-Bot-Api-Secret-Token header. We reject anything
 * that doesn't match TELEGRAM_WEBHOOK_SECRET (fail closed).
 *
 * Handles today:
 *   /start <code>  → link the sender's Telegram to the app account that
 *                    generated <code>.
 *   /start         → greeting.
 *   /whoami        → report the linked account.
 * Free-text callout creation + inline buttons land in a later phase.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false; // fail closed until configured
  return req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

async function linkedUser(chatId: string) {
  return prisma.user.findFirst({
    where: { telegramChatId: chatId, active: true },
    select: { id: true, name: true, role: true },
  });
}

/** Consume a link code and attach it to this chat. */
async function tryLink(
  chatId: string,
  code: string,
): Promise<string> {
  const user = await prisma.user.findFirst({
    where: {
      telegramLinkCode: code,
      OR: [
        { telegramLinkExpires: null },
        { telegramLinkExpires: { gt: new Date() } },
      ],
    },
    select: { id: true, name: true },
  });
  if (!user) {
    return "That link code is invalid or has expired. Generate a fresh one in the app (Connect Telegram) and try again.";
  }
  await prisma.$transaction([
    // A Telegram chat maps to exactly one account — detach any prior owner.
    prisma.user.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramChatId: null },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramLinkCode: null,
        telegramLinkExpires: null,
      },
    }),
  ]);
  return `✅ Linked to <b>${escapeHtml(user.name)}</b>. You'll get alerts here and can run commands. Try /whoami.`;
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let update: any = null;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ignore junk, don't retry-storm
  }

  try {
    // Button taps — acknowledge for now (interactive flows land later).
    if (update?.callback_query) {
      await answerCallbackQuery(update.callback_query.id);
      return NextResponse.json({ ok: true });
    }

    const msg = update?.message;
    const chatId = msg?.chat?.id;
    const text: string = (msg?.text ?? "").trim();
    if (!chatId || !text) return NextResponse.json({ ok: true });
    const chat = String(chatId);

    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1];
      if (code) {
        const reply = await tryLink(chat, code);
        await sendTelegramMessage(chat, reply);
      } else {
        const who = await linkedUser(chat);
        await sendTelegramMessage(
          chat,
          who
            ? `Hi ${escapeHtml(who.name)} — you're connected. Try /whoami.`
            : "Welcome to the 1st Nationwide bot. To connect your account, open the app → <b>Connect Telegram</b> and tap the link there.",
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/whoami")) {
      const who = await linkedUser(chat);
      await sendTelegramMessage(
        chat,
        who
          ? `You're connected as <b>${escapeHtml(who.name)}</b> (${who.role.toLowerCase()}).`
          : "This chat isn't linked to an account yet. Open the app → Connect Telegram.",
      );
      return NextResponse.json({ ok: true });
    }

    // Any other message from a linked user — placeholder until the
    // callout-by-message flow ships.
    const who = await linkedUser(chat);
    await sendTelegramMessage(
      chat,
      who
        ? "Got it. Creating callouts by message is coming next — for now, log them in the app."
        : "This chat isn't linked yet. Open the app → Connect Telegram, then send the link code here.",
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("telegram webhook error", e);
    return NextResponse.json({ ok: true }); // never make Telegram retry-storm
  }
}
