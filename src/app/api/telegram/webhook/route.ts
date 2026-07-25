import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  answerCallbackQuery,
  editTelegramMessage,
  escapeHtml,
  sendTelegramMessage,
} from "@/lib/telegram";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { createBotCallout, type BotCalloutData } from "@/lib/callouts";
import {
  calloutCancelData,
  calloutConfirmData,
  decodeCalloutAction,
  parseCalloutText,
  resolveCallout,
} from "@/lib/telegramCallout";

/**
 * Telegram bot webhook. Telegram POSTs every update here.
 *
 * Security: the webhook is registered with a secret_token, which Telegram
 * echoes in the X-Telegram-Bot-Api-Secret-Token header. We reject anything
 * that doesn't match TELEGRAM_WEBHOOK_SECRET (fail closed).
 *
 * Handles:
 *   /start <code>  → link the sender's Telegram to the app account that
 *                    generated <code>.
 *   /start, /whoami → greeting / identity.
 *   free text (from a linked ADMIN/DISPATCHER) → AI-parse into a callout,
 *                    reply with a Confirm/Cancel card. Confirm creates the
 *                    Job (assigned), Cancel discards. Nothing hits the live
 *                    board until Confirm.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "ADMIN" | "DISPATCHER" | "OFFICER" | "PARTNER" | "PARTNER_OFFICER";

function authorised(req: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false; // fail closed until configured
  return req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

function isStaff(role: Role): boolean {
  return role === "ADMIN" || role === "DISPATCHER";
}

async function linkedUser(chatId: string) {
  return prisma.user.findFirst({
    where: { telegramChatId: chatId, active: true },
    select: { id: true, name: true, role: true },
  });
}

/** Consume a link code and attach it to this chat. */
async function tryLink(chatId: string, code: string): Promise<string> {
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

/** Current UK date + time, richly formatted, so the model can resolve
 *  relative times ("tonight", "in an hour") correctly. */
function ukNowString(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/** A phrase worth attempting to parse — filters out "hi" / "ok" chatter. */
function looksLikeCallout(text: string): boolean {
  const t = text.trim();
  return t.length >= 6 && /\s/.test(t);
}

/**
 * Turn a dispatcher's message into a callout draft + confirmation card.
 * Only reached for linked ADMIN/DISPATCHER users.
 */
async function handleCalloutMessage(
  chat: string,
  who: { id: string },
  text: string,
): Promise<void> {
  if (!isAnthropicConfigured()) {
    await sendTelegramMessage(
      chat,
      "Message-to-callout isn't switched on yet (it needs the AI key). You can still add callouts in the app.",
    );
    return;
  }

  const [officers, partners, sites] = await prisma.$transaction([
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true, role: { in: ["SUBCONTRACTOR", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, postcodeFormatted: true },
    }),
  ]);

  const parsed = await parseCalloutText(text, {
    officers,
    partners,
    nowUk: ukNowString(),
  });
  if (!parsed.ok) {
    console.error("telegram callout parse error", parsed.error);
    await sendTelegramMessage(
      chat,
      "Sorry — I couldn't read that just now. Try again in a moment, or add it in the app.",
    );
    return;
  }

  const resolved = resolveCallout(parsed.parsed, {
    sites: sites.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      postcode: s.postcodeFormatted,
    })),
    officers,
    partners,
  });

  if (!resolved.ok || !resolved.data) {
    const body = [
      "I couldn't set that up yet:",
      ...resolved.problems.map((p) => `• ${p}`),
      "",
      "What I caught:",
      resolved.summary,
    ].join("\n");
    await sendTelegramMessage(chat, escapeHtml(body));
    return;
  }

  // Persist the resolved payload (JSON-safe: Date → ISO string) so a button
  // tap can create the Job later without re-parsing.
  const payloadJson = {
    ...resolved.data,
    scheduledFor: resolved.data.scheduledFor
      ? resolved.data.scheduledFor.toISOString()
      : null,
  };
  const draft = await prisma.telegramCalloutDraft.create({
    data: {
      chatId: chat,
      createdByUserId: who.id,
      payload: payloadJson,
      summary: resolved.summary,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
    select: { id: true },
  });

  const sent = await sendTelegramMessage(
    chat,
    `📋 <b>New callout — confirm?</b>\n\n${escapeHtml(resolved.summary)}`,
    [
      [
        { text: "✅ Confirm", callback_data: calloutConfirmData(draft.id) },
        { text: "✖️ Cancel", callback_data: calloutCancelData(draft.id) },
      ],
    ],
  );
  if (sent.messageId) {
    await prisma.telegramCalloutDraft.update({
      where: { id: draft.id },
      data: { messageId: sent.messageId },
    });
  }
}

/** Handle a Confirm / Cancel tap on a callout card. */
async function handleCalloutCallback(cbq: any): Promise<void> {
  const chatId = cbq?.message?.chat?.id;
  const messageId: number | undefined = cbq?.message?.message_id;
  const decoded = decodeCalloutAction(String(cbq?.data ?? ""));
  if (!chatId || !decoded) {
    await answerCallbackQuery(cbq.id);
    return;
  }
  const chat = String(chatId);

  const draft = await prisma.telegramCalloutDraft.findUnique({
    where: { id: decoded.draftId },
  });
  if (!draft || draft.chatId !== chat) {
    await answerCallbackQuery(cbq.id, "That callout's no longer available.");
    return;
  }
  if (draft.status !== "PENDING" || draft.expiresAt.getTime() < Date.now()) {
    if (messageId) {
      await editTelegramMessage(
        chat,
        messageId,
        `⌛ <b>Expired / already handled.</b>\n\n${escapeHtml(draft.summary)}`,
        [],
      );
    }
    await answerCallbackQuery(cbq.id, "Already handled or expired.");
    return;
  }

  // Only a linked staff member on this chat may act on the card.
  const who = await linkedUser(chat);
  if (!who || !isStaff(who.role as Role)) {
    await answerCallbackQuery(cbq.id, "Not allowed.");
    return;
  }

  if (decoded.action === "cancel") {
    await prisma.telegramCalloutDraft.update({
      where: { id: draft.id },
      data: { status: "CANCELLED" },
    });
    if (messageId) {
      await editTelegramMessage(
        chat,
        messageId,
        `✖️ <b>Cancelled.</b>\n\n${escapeHtml(draft.summary)}`,
        [],
      );
    }
    await answerCallbackQuery(cbq.id, "Cancelled.");
    return;
  }

  // Confirm → create the Job from the stored payload (re-hydrate the Date).
  const raw = draft.payload as any;
  const data: BotCalloutData = {
    ...raw,
    scheduledFor: raw.scheduledFor ? new Date(raw.scheduledFor) : null,
  };
  const result = await createBotCallout(data, { id: draft.createdByUserId });
  if (!result.ok) {
    if (messageId) {
      await editTelegramMessage(
        chat,
        messageId,
        `⚠️ <b>Couldn't create the callout.</b>\n\n${escapeHtml(result.error)}\n\n${escapeHtml(draft.summary)}`,
        [],
      );
    }
    await answerCallbackQuery(cbq.id, "Couldn't create.");
    return;
  }

  await prisma.telegramCalloutDraft.update({
    where: { id: draft.id },
    data: { status: "CONFIRMED" },
  });
  const statusWord =
    result.status === "ASSIGNED" ? "assigned" : "logged (unassigned)";
  if (messageId) {
    await editTelegramMessage(
      chat,
      messageId,
      `✅ <b>Callout ${statusWord}.</b>\n\n${escapeHtml(draft.summary)}`,
      [],
    );
  }
  await answerCallbackQuery(cbq.id, "Done ✅");
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
    // Button taps.
    if (update?.callback_query) {
      await handleCalloutCallback(update.callback_query);
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
            ? `Hi ${escapeHtml(who.name)} — you're connected. ${isStaff(who.role as Role) ? "Message me a callout, e.g. “Alarm at Neasden, send John”." : "Try /whoami."}`
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

    // Any other text: for linked staff, treat it as a callout to create.
    const who = await linkedUser(chat);
    if (!who) {
      await sendTelegramMessage(
        chat,
        "This chat isn't linked yet. Open the app → Connect Telegram, then send the link code here.",
      );
      return NextResponse.json({ ok: true });
    }
    if (!isStaff(who.role as Role)) {
      await sendTelegramMessage(
        chat,
        "You're connected. Creating callouts by message is for dispatch/admin — you'll get your alerts here.",
      );
      return NextResponse.json({ ok: true });
    }
    if (!looksLikeCallout(text)) {
      await sendTelegramMessage(
        chat,
        "Tell me the site and who to send, e.g. “Alarm at Neasden, send John” or “Lock-up Norbury, give to Nexus”.",
      );
      return NextResponse.json({ ok: true });
    }
    await handleCalloutMessage(chat, who, text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("telegram webhook error", e);
    return NextResponse.json({ ok: true }); // never make Telegram retry-storm
  }
}
