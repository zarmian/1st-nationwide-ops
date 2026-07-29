import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  answerCallbackQuery,
  editTelegramMessage,
  escapeHtml,
  sendTelegramMessage,
} from "@/lib/telegram";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { createBotCallout, type BotCalloutData } from "@/lib/callouts";
import { snapshotJobFinanceIfNeeded } from "@/lib/billing";
import {
  calloutCancelData,
  calloutConfirmData,
  decodeCalloutAction,
  decodeJobAction,
  jobActionData,
  matchSite,
  resolveCallout,
  routeMessage,
} from "@/lib/telegramCallout";
import {
  dayRundownMessage,
  myDayMessage,
  nowMessage,
} from "@/lib/dayActivities";
import { keyLookupMessage, siteLookupMessage } from "@/lib/telegramLookup";

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
 * Route a linked staff member's free text: either list a day's activities or
 * draft a new callout for confirmation. Only reached for ADMIN/DISPATCHER.
 */
async function handleFreeText(
  chat: string,
  who: { id: string },
  text: string,
): Promise<void> {
  if (!isAnthropicConfigured()) {
    await sendTelegramMessage(
      chat,
      "Plain-English requests aren't switched on yet (they need the AI key). For schedules use /today, /yesterday or /tomorrow. Add callouts in the app for now.",
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

  const siteCtx = sites.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    postcode: s.postcodeFormatted,
  }));

  const routed = await routeMessage(text, {
    officers,
    partners,
    nowUk: ukNowString(),
  });
  if (routed.kind === "error") {
    console.error("telegram route error", routed.error);
    await sendTelegramMessage(
      chat,
      "Sorry — I couldn't read that just now. Try again in a moment, or use /today for the schedule.",
    );
    return;
  }

  if (routed.kind === "lookupSite") {
    await sendTelegramMessage(chat, await siteLookupMessage(routed.query));
    return;
  }
  if (routed.kind === "lookupKey") {
    await sendTelegramMessage(chat, await keyLookupMessage(routed.query));
    return;
  }

  // "What's on today?" / "on now?" style question → list activities.
  if (routed.kind === "list") {
    // "now" is a live cross-site snapshot; a site filter doesn't apply.
    if (routed.day === "now") {
      await sendTelegramMessage(chat, await nowMessage());
      return;
    }
    let siteId: string | undefined;
    let siteNote: string | undefined;
    if (routed.siteQuery) {
      const m = matchSite(routed.siteQuery, siteCtx);
      if (m.kind === "one") {
        siteId = m.site.id;
        siteNote = `at ${m.site.name}`;
      } else {
        siteNote = `(couldn't match “${routed.siteQuery}” — showing all sites)`;
      }
    }
    const msg = await dayRundownMessage(routed.day, { siteId, siteNote });
    await sendTelegramMessage(chat, msg);
    return;
  }

  // Otherwise it's a new callout to create.
  const resolved = resolveCallout(routed.parsed, {
    sites: siteCtx,
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

/** Handle an officer's "On site" / "Complete" tap on an assignment ping. */
async function handleJobActionCallback(cbq: any): Promise<void> {
  const chatId = cbq?.message?.chat?.id;
  const messageId: number | undefined = cbq?.message?.message_id;
  const decoded = decodeJobAction(String(cbq?.data ?? ""));
  if (!chatId || !decoded) {
    await answerCallbackQuery(cbq.id);
    return;
  }
  const chat = String(chatId);
  const who = await linkedUser(chat);
  if (!who) {
    await answerCallbackQuery(cbq.id, "Link your account first.");
    return;
  }

  const job = await prisma.job.findUnique({
    where: { id: decoded.jobId },
    select: {
      id: true,
      status: true,
      assignedToUserId: true,
      startedAt: true,
      notes: true,
      site: { select: { name: true } },
    },
  });
  if (!job) {
    await answerCallbackQuery(cbq.id, "Job not found.");
    return;
  }
  // Only the assignee (or staff) may act on it.
  if (job.assignedToUserId !== who.id && !isStaff(who.role as Role)) {
    await answerCallbackQuery(cbq.id, "That's not your job.");
    return;
  }
  if (job.status === "CANCELLED") {
    await answerCallbackQuery(cbq.id, "This job was cancelled.");
    return;
  }
  const siteName = job.site?.name ?? "site";
  const done = ["APPROVED", "SENT_TO_CLIENT", "CLOSED"].includes(job.status);

  if (decoded.action === "onsite") {
    if (done) {
      await answerCallbackQuery(cbq.id, "Already completed.");
      return;
    }
    await prisma.job.update({
      where: { id: job.id },
      data: {
        startedAt: job.startedAt ?? new Date(),
        status: "IN_PROGRESS" as any,
      },
    });
    revalidatePath("/dispatch");
    revalidatePath("/activities");
    await answerCallbackQuery(cbq.id, "Marked on site ✅");
    if (messageId) {
      await editTelegramMessage(
        chat,
        messageId,
        `🔵 <b>On site</b> — ${escapeHtml(siteName)}\n\nTap Complete when you're done.`,
        [
          [
            {
              text: "🏁 Complete",
              callback_data: jobActionData("complete", job.id),
            },
          ],
        ],
      );
    }
    return;
  }

  // Complete.
  if (done) {
    await answerCallbackQuery(cbq.id, "Already completed.");
    if (messageId) {
      await editTelegramMessage(
        chat,
        messageId,
        `🏁 <b>Completed</b> — ${escapeHtml(siteName)}`,
        [],
      );
    }
    return;
  }
  const now = new Date();
  const stamp = `Completed via Telegram by ${who.name} at ${now.toISOString()}`;
  await prisma.job.update({
    where: { id: job.id },
    data: {
      startedAt: job.startedAt ?? now,
      completedAt: now,
      status: "APPROVED" as any,
      notes: job.notes ? `${job.notes}\n${stamp}` : stamp,
    },
  });
  // Fill billing + officer pay for the just-completed job (no-op if already set).
  await snapshotJobFinanceIfNeeded(job.id).catch((e) =>
    console.error("snapshotJobFinanceIfNeeded (telegram complete) failed", e),
  );
  revalidatePath("/dispatch");
  revalidatePath("/activities");
  revalidatePath("/finance");
  await answerCallbackQuery(cbq.id, "Completed 🏁");
  if (messageId) {
    await editTelegramMessage(
      chat,
      messageId,
      `🏁 <b>Completed</b> — ${escapeHtml(siteName)}\n\nAdd a full report in the app if one's needed.`,
      [],
    );
  }
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
    // Button taps — route by callback_data prefix.
    if (update?.callback_query) {
      const data = String(update.callback_query.data ?? "");
      if (decodeJobAction(data)) {
        await handleJobActionCallback(update.callback_query);
      } else {
        await handleCalloutCallback(update.callback_query);
      }
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
            ? `Hi ${escapeHtml(who.name)} — you're connected. ${isStaff(who.role as Role) ? "Ask me /now, /today, /yesterday or /tomorrow, or message me a callout like “Alarm at Neasden, send John”." : "Send /mine to see your jobs for today, and tap the buttons on jobs I send you."}`
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

    // Rundown commands — /now, /today, /yesterday, /tomorrow (with or without
    // the leading slash, and tolerating a @botname suffix in groups). These
    // are deterministic and need no AI, so they work even before the key is
    // set.
    const firstWord = text
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/^\//, "")
      .replace(/@.*/, "");

    // /mine — the sender's own jobs today. Works for any linked user.
    if (firstWord === "mine" || firstWord === "myjobs") {
      const who = await linkedUser(chat);
      if (!who) {
        await sendTelegramMessage(
          chat,
          "This chat isn't linked yet. Open the app → Connect Telegram.",
        );
        return NextResponse.json({ ok: true });
      }
      await sendTelegramMessage(chat, await myDayMessage(who.id));
      return NextResponse.json({ ok: true });
    }

    // /site <query> and /key <query> — staff lookups.
    if (firstWord === "site" || firstWord === "key") {
      const who = await linkedUser(chat);
      if (!who) {
        await sendTelegramMessage(
          chat,
          "This chat isn't linked yet. Open the app → Connect Telegram.",
        );
        return NextResponse.json({ ok: true });
      }
      if (!isStaff(who.role as Role)) {
        await sendTelegramMessage(chat, "Lookups are for dispatch/admin.");
        return NextResponse.json({ ok: true });
      }
      const rest = text.replace(/^\S+\s*/, "").trim();
      const reply =
        firstWord === "site"
          ? await siteLookupMessage(rest)
          : await keyLookupMessage(rest);
      await sendTelegramMessage(chat, reply);
      return NextResponse.json({ ok: true });
    }

    if (
      firstWord === "now" ||
      firstWord === "today" ||
      firstWord === "yesterday" ||
      firstWord === "tomorrow"
    ) {
      const who = await linkedUser(chat);
      if (!who) {
        await sendTelegramMessage(
          chat,
          "This chat isn't linked yet. Open the app → Connect Telegram.",
        );
        return NextResponse.json({ ok: true });
      }
      if (!isStaff(who.role as Role)) {
        await sendTelegramMessage(chat, "Schedules are for dispatch/admin.");
        return NextResponse.json({ ok: true });
      }
      const msg =
        firstWord === "now"
          ? await nowMessage()
          : await dayRundownMessage(firstWord);
      await sendTelegramMessage(chat, msg);
      return NextResponse.json({ ok: true });
    }

    // Any other text: for linked staff, route it (list a day or new callout).
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
        "You're connected. Send /mine for your jobs today, and tap the buttons on jobs I send you.",
      );
      return NextResponse.json({ ok: true });
    }
    if (!looksLikeCallout(text)) {
      await sendTelegramMessage(
        chat,
        "Ask me a schedule (/today, /yesterday, /tomorrow) or add a callout, e.g. “Alarm at Neasden, send John”.",
      );
      return NextResponse.json({ ok: true });
    }
    await handleFreeText(chat, who, text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("telegram webhook error", e);
    return NextResponse.json({ ok: true }); // never make Telegram retry-storm
  }
}
