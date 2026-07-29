import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  answerCallbackQuery,
  editTelegramMessage,
  escapeHtml,
  requestLocation,
  sendAndClearKeyboard,
  sendTelegramMessage,
} from "@/lib/telegram";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { createBotCallout, type BotCalloutData } from "@/lib/callouts";
import { snapshotJobFinanceIfNeeded } from "@/lib/billing";
import {
  cancelJobCore,
  closeJobCore,
  reassignJobCore,
} from "@/lib/jobActions";
import {
  calloutCancelData,
  calloutConfirmData,
  decodeCalloutAction,
  decodeJobAction,
  jobActionData,
  matchPerson,
  matchSite,
  resolveCallout,
  routeMessage,
  type RoutedMessage,
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

/** Anything with real content is worth routing — the AI classifies it
 *  (including greetings, which get a friendly help reply). */
function worthRouting(text: string): boolean {
  return text.trim().length >= 2;
}

const ACTIVE_JOB_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVIEW_PENDING",
] as const;

/** Loose map from a spoken job kind to a JobType, for narrowing the target. */
function mapTypeHint(hint: string | null): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (h.includes("alarm")) return "ALARM_RESPONSE";
  if (h.includes("unlock")) return "UNLOCK";
  if (h.includes("lock")) return "LOCK";
  if (h.includes("patrol")) return "PATROL";
  if (h.includes("vpi")) return "VPI";
  return null;
}

function jobDesc(
  job: { type: string; typeLabel: string | null; assignedTo: { name: string } | null },
  siteName: string,
): string {
  const kind = job.typeLabel?.trim() || job.type.replace(/_/g, " ").toLowerCase();
  const who = job.assignedTo?.name;
  return `${kind} at ${siteName}${who ? ` (${who})` : ""}`;
}

/** Stash a job action as a draft and send a Confirm/Cancel card. */
async function createJobActionDraft(
  chat: string,
  userId: string,
  payload: Record<string, unknown>,
  summary: string,
): Promise<void> {
  const draft = await prisma.telegramCalloutDraft.create({
    data: {
      chatId: chat,
      createdByUserId: userId,
      payload: payload as any,
      summary,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
    select: { id: true },
  });
  const sent = await sendTelegramMessage(
    chat,
    `⚠️ <b>Confirm?</b>\n\n${escapeHtml(summary)}`,
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

/**
 * Resolve "the Neasden alarm" to a single active job, then draft a
 * reassign / cancel / close for confirmation.
 */
async function handleJobActionRequest(
  chat: string,
  who: { id: string },
  routed: Extract<
    RoutedMessage,
    { kind: "reassignJob" | "cancelJob" | "closeJob" }
  >,
  siteCtx: {
    id: string;
    name: string;
    code: string | null;
    postcode: string | null;
    address?: string | null;
  }[],
  officers: { id: string; name: string }[],
): Promise<void> {
  const m = matchSite(routed.siteQuery, siteCtx);
  if (m.kind !== "one") {
    await sendTelegramMessage(
      chat,
      m.kind === "none"
        ? `I couldn't find a site matching “${escapeHtml(routed.siteQuery)}”.`
        : `“${escapeHtml(routed.siteQuery)}” matches several sites — be more specific.`,
    );
    return;
  }

  const type = mapTypeHint(routed.typeHint);
  const jobs = await prisma.job.findMany({
    where: {
      siteId: m.site.id,
      status: { in: ACTIVE_JOB_STATUSES as any },
      ...(type ? { type: type as any } : {}),
    },
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 10,
    select: {
      id: true,
      type: true,
      typeLabel: true,
      assignedTo: { select: { name: true } },
    },
  });
  if (jobs.length === 0) {
    await sendTelegramMessage(
      chat,
      `No active job at ${escapeHtml(m.site.name)}${type ? " of that type" : ""}.`,
    );
    return;
  }
  if (jobs.length > 1) {
    const list = jobs
      .slice(0, 6)
      .map((j) => `• ${escapeHtml(jobDesc(j, m.site.name))}`)
      .join("\n");
    await sendTelegramMessage(
      chat,
      `Several active jobs at ${escapeHtml(m.site.name)} — say the type too:\n${list}`,
    );
    return;
  }

  const job = jobs[0];
  const desc = jobDesc(job, m.site.name);

  if (routed.kind === "reassignJob") {
    const pm = matchPerson(routed.officerName, officers);
    if (pm.kind !== "one") {
      await sendTelegramMessage(
        chat,
        pm.kind === "none"
          ? `I couldn't find an officer matching “${escapeHtml(routed.officerName)}”.`
          : `“${escapeHtml(routed.officerName)}” matches several officers — which one?`,
      );
      return;
    }
    await createJobActionDraft(
      chat,
      who.id,
      { kind: "reassign", jobId: job.id, officerId: pm.person.id },
      `Reassign: ${desc} → ${pm.person.name}`,
    );
    return;
  }

  const verb = routed.kind === "cancelJob" ? "Cancel" : "Close";
  await createJobActionDraft(
    chat,
    who.id,
    { kind: routed.kind === "cancelJob" ? "cancel" : "close", jobId: job.id },
    `${verb}: ${desc}`,
  );
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
      select: {
        id: true,
        name: true,
        code: true,
        postcodeFormatted: true,
        addressLine: true,
        city: true,
      },
    }),
  ]);

  const siteCtx = sites.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    postcode: s.postcodeFormatted,
    address: [s.addressLine, s.city].filter(Boolean).join(" "),
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

  if (routed.kind === "help") {
    await sendTelegramMessage(
      chat,
      [
        "Hi 👋 I'm the 1st Nationwide dispatch bot. You can just talk to me — a few things I can do:",
        "",
        "• <b>Add a callout</b> — “Alarm at Neasden, send John”",
        "• <b>Find a site</b> — “tesco downham”, “tesco br1” (name, address or postcode)",
        "• <b>What's on</b> — /now, /today, /yesterday, /tomorrow",
        "• <b>Keys</b> — “who has the keys for Norbury”",
        "• <b>Change a job</b> — “move the Neasden alarm to Jane”, “cancel the Norbury lock-up”",
      ].join("\n"),
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

  // Act on an existing job — reassign / cancel / close (confirmed).
  if (
    routed.kind === "reassignJob" ||
    routed.kind === "cancelJob" ||
    routed.kind === "closeJob"
  ) {
    await handleJobActionRequest(chat, who, routed, siteCtx, officers);
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

  const raw = draft.payload as any;

  // Job actions (reassign / cancel / close) ride the same draft + confirm
  // path; the payload's `kind` decides which core runs.
  if (raw?.kind === "reassign" || raw?.kind === "cancel" || raw?.kind === "close") {
    const r =
      raw.kind === "reassign"
        ? await reassignJobCore(raw.jobId, raw.officerId ?? null)
        : raw.kind === "cancel"
          ? await cancelJobCore(raw.jobId, who.id)
          : await closeJobCore(raw.jobId, {
              note: `Closed via Telegram by ${who.name}`,
            });
    await prisma.telegramCalloutDraft.update({
      where: { id: draft.id },
      data: { status: r.ok ? "CONFIRMED" : "CANCELLED" },
    });
    revalidatePath("/dispatch");
    revalidatePath("/activities");
    revalidatePath("/finance");
    if (messageId) {
      await editTelegramMessage(
        chat,
        messageId,
        r.ok
          ? `✅ <b>Done.</b>\n\n${escapeHtml(draft.summary)}`
          : `⚠️ <b>Couldn't do that.</b>\n\n${escapeHtml(r.error ?? "")}\n\n${escapeHtml(draft.summary)}`,
        [],
      );
    }
    await answerCallbackQuery(cbq.id, r.ok ? "Done ✅" : "Couldn't do that.");
    return;
  }

  // Confirm → create the Job from the stored payload (re-hydrate the Date).
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

/** Remember which job the officer is sharing a location for, and ask. */
async function promptForLocation(
  chat: string,
  userId: string,
  jobId: string,
): Promise<void> {
  await prisma.user
    .update({ where: { id: userId }, data: { pendingLocationJobId: jobId } })
    .catch(() => {});
  await requestLocation(
    chat,
    "📍 Optional — tap to share your location for the record.",
  );
}

/** A shared Telegram location → stamp it on the job the officer just acted on. */
async function handleLocationShare(
  chat: string,
  location: { latitude: number; longitude: number },
): Promise<void> {
  const who = await prisma.user.findFirst({
    where: { telegramChatId: chat, active: true },
    select: { id: true, pendingLocationJobId: true },
  });
  if (!who?.pendingLocationJobId) {
    await sendAndClearKeyboard(chat, "Thanks — nothing's waiting on a location.");
    return;
  }
  const job = await prisma.job.findUnique({
    where: { id: who.pendingLocationJobId },
    select: { id: true, assignedToUserId: true },
  });
  await prisma.user.update({
    where: { id: who.id },
    data: { pendingLocationJobId: null },
  });
  if (job && job.assignedToUserId === who.id) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        lat: location.latitude,
        lng: location.longitude,
        locatedAt: new Date(),
      },
    });
    revalidatePath("/dispatch");
    revalidatePath("/activities");
    await sendAndClearKeyboard(chat, "📍 Location saved — thanks!");
  } else {
    await sendAndClearKeyboard(chat, "📍 Got it.");
  }
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
    if (job.assignedToUserId === who.id) {
      await promptForLocation(chat, who.id, job.id);
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
  if (job.assignedToUserId === who.id) {
    await promptForLocation(chat, who.id, job.id);
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
    // A shared location arrives as a location message (no text).
    if (chatId && msg?.location) {
      await handleLocationShare(String(chatId), msg.location);
      return NextResponse.json({ ok: true });
    }
    const text: string = (msg?.text ?? "").trim();
    if (!chatId || !text) return NextResponse.json({ ok: true });
    const chat = String(chatId);

    // "Skip" from the location keyboard — only when a prompt is pending.
    if (text.toLowerCase() === "skip") {
      const cleared = await prisma.user.updateMany({
        where: { telegramChatId: chat, NOT: { pendingLocationJobId: null } },
        data: { pendingLocationJobId: null },
      });
      if (cleared.count > 0) {
        await sendAndClearKeyboard(chat, "No problem.");
        return NextResponse.json({ ok: true });
      }
    }

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
    if (!worthRouting(text)) {
      await sendTelegramMessage(chat, "👋 Say a bit more and I'll help.");
      return NextResponse.json({ ok: true });
    }
    await handleFreeText(chat, who, text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("telegram webhook error", e);
    return NextResponse.json({ ok: true }); // never make Telegram retry-storm
  }
}
