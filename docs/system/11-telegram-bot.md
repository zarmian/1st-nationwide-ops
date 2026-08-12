# Telegram Dispatch Bot

> A conversational Telegram bot that turns a dispatcher's plain-English message into a resolved, confirmed callout (or schedule/site/key lookup) via an AI intent router, and lets officers report jobs done by message or button tap.

## Purpose & scope

The bot is a second front-end for the ops platform, reached over Telegram instead of the web app. It serves two audiences off one webhook:

- **Staff (`ADMIN` / `DISPATCHER`)** — full surface: create a callout, reassign / cancel / close an existing job, look up sites and keys, and read the schedule ("what's on now / today / a date"), all in free text or via slash-commands.
- **Officers (`OFFICER`)** — a deliberately narrow surface: report their *own* activity done ("Norbury unlocked"), see their own day (`/mine`), and act on the **On site / Complete** buttons the bot DMs them.

The design principle running through the whole flow: **the AI only classifies and extracts; it never mutates.** Every extraction is matched against the *real* roster by pure, unit-tested code, staged as an inert draft, and only written to the live board after an explicit **Confirm** tap (or, for an officer's own self-report, after an unambiguous single match).

Outbound alert *content* (assignment pings, missed-call broadcasts, no-shows, the daily brief) lives in `src/lib/telegramNotify.ts` and `src/lib/notifications.ts` — see `10-notifications.md`. The 07:00 daily brief cron is in `13-crons.md`.

## Data model

### `TelegramCalloutDraft` (`prisma/schema.prisma:1219`)

The draft/confirm ledger. One row per confirmation card sent.

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | |
| `chatId` | `String` | Telegram chat the card was sent to. |
| `createdByUserId` | `uuid` → `User` | Cascade delete. The staff member who triggered it. |
| `payload` | `Json` | Either a resolved `BotCalloutData` (new callout) **or** a job-action bag `{kind:"reassign"\|"cancel"\|"close", …}`. `scheduledFor` is stored as an ISO string, re-hydrated to `Date` on confirm. |
| `summary` | `String` | Human-readable confirmation text shown on the card. |
| `status` | `String` | `PENDING` → `CONFIRMED` \| `CANCELLED`. Terminal states kept briefly for idempotency (double-tap = no-op). |
| `messageId` | `Int?` | The card's Telegram message id, so the webhook can **edit it in place** on action. |
| `createdAt` / `expiresAt` | `DateTime` | Callers set `expiresAt = now + 15 min`. |

Indexes: `@@index([chatId, status])`, `@@index([expiresAt])`. There is **no cron sweeping expired/terminal drafts** — see gotchas.

### `User` — Telegram fields (`prisma/schema.prisma:388-398`)

| Field | Purpose |
|---|---|
| `telegramChatId String? @unique` | Set at link time; used both to DM the user and to authorise inbound commands. One chat ↔ one account. |
| `telegramLinkCode String? @unique` | One-time code minted in-app, sent to the bot via a `t.me` deep link. Cleared once linked. |
| `telegramLinkExpires DateTime?` | 15-minute code TTL. |
| `pendingLocationJobId String? @db.Uuid` | The job an officer is being asked to share a location for (set on On-site/Complete, cleared on share or skip). |

### `Job` geo (`prisma/schema.prisma:1014-1016`)

`lat` / `lng` / `locatedAt` — stamped when an officer shares a Telegram location for a job they own. (Distinct from `User.lastLat/lastLng/lastSeenAt` at `385-387`, which is the officer's *live* position for the map — see `12-integrations-webhooks.md`.)

## Key files

| File | Role |
|---|---|
| `src/app/api/telegram/webhook/route.ts` | The only runtime entry. Verifies the secret, dispatches every update (text / callback / location / linking), owns the handler functions. |
| `src/lib/telegram.ts` | Bot API wrapper (raw `fetch`, no SDK): `sendTelegramMessage`, `editTelegramMessage`, `requestLocation`, `answerCallbackQuery`, `setWebhook`, `getWebhookInfo`, `setMyCommands`, `BOT_COMMANDS`, `escapeHtml`. |
| `src/lib/telegramCallout.ts` | The AI router (`routeMessage`), the pure resolvers (`matchSite`, `matchPerson`, `resolveScope`, `resolveCallout`), the tool schemas, and the `callback_data` encode/decode helpers. |
| `src/lib/anthropic.ts` | Anthropic Messages API wrapper: `extractWithTools` (multi-tool router), `extractWithTool` (single forced tool), `isAnthropicConfigured`. |
| `src/lib/calloutTypes.ts` | DB-free enums + `BotCalloutData` shape, shared by the resolver and the DB creator so the resolver never imports Prisma. |
| `src/lib/callouts.ts` | `createBotCallout` — writes the confirmed `Job` (and `AlarmEvent`), snapshots billing/pay, fires notifications. |
| `src/lib/jobActions.ts` | Shared state-transition cores: `reassignJobCore`, `cancelJobCore`, `closeJobCore`, `completeVisitCore`. Auth-free; the webhook and the web actions both wrap them. |
| `src/lib/telegramLookup.ts` | Read-only `siteLookupMessage` / `keyLookupMessage` (staff only, no access codes over chat). |
| `src/lib/dayActivities.ts` | Loaders: `loadDayActivities`, `dayRundownMessage`, `myDayMessage`, `loadNowSnapshot`, `nowMessage`. Merges jobs + patrol visits + shifts. |
| `src/lib/dayActivitiesFormat.ts` | Pure (DB-free) date parsing (`resolveDayTarget`, `parseUkDateString`) + message formatting (`formatDayActivitiesMessage`, `formatNowMessage`). |
| `src/lib/telegramNotify.ts` | Outbound, DB-touching alerts (assignment ping with buttons, broadcasts). See `10-notifications.md`. |
| `src/app/(app)/telegram/page.tsx` + `_actions.ts` + `ConnectTelegram.tsx` + `WebhookSetup.tsx` | The admin link/setup page and its server actions. |

## Core flows / mechanics

### 1. Account linking

1. Signed-in staff open `/telegram` → **Get my connect link** → `generateTelegramLinkCode` (`_actions.ts`) mints `randomBytes(9).toString("base64url")`, stores it as `telegramLinkCode` with a 15-min `telegramLinkExpires`, and returns a `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>` deep link.
2. Opening the link in Telegram and tapping **Start** sends `/start <code>` to the bot.
3. The webhook's `tryLink(chatId, code)` finds the user by unexpired `telegramLinkCode`, then in one `$transaction` **detaches any prior owner of this chat** (`telegramChatId → null`) and attaches it to the code's user, clearing the code + expiry. Result: one chat maps to exactly one account.
4. `disconnectTelegram` clears all three fields.

### 2. Webhook security

- Registered with `setWebhook(url, secret)` where `secret = TELEGRAM_WEBHOOK_SECRET`. Telegram echoes it in the `X-Telegram-Bot-Api-Secret-Token` header on every update.
- `authorised(req)` compares the header to the env var and **fails closed** when the var is unset. A mismatch returns `401`.
- Every other code path returns `200 {ok:true}` — including on thrown errors and bad JSON — so Telegram never retry-storms.
- `webhookUrl()` derives the endpoint from `NEXTAUTH_URL`, so the deploy domain is never hard-coded. `setWebhook` also sends `drop_pending_updates: true` and `allowed_updates: ["message", "callback_query"]`.

### 3. Update dispatch (`POST`)

```
update.callback_query?  → decodeJobAction(data) ? handleJobActionCallback : handleCalloutCallback
update.message.location? → handleLocationShare
text "skip"             → clear pendingLocationJobId (only if one is pending)
/start [code]           → tryLink or greeting
/whoami                 → identity
/mine /myjobs           → myDayMessage (any linked user)
/site /key <q>          → lookups (staff only)
/now /today /yesterday /tomorrow → deterministic schedule (staff only, no AI)
any other text          → handleFreeText (AI)
```

Slash-command matching strips a leading `/` and a `@botname` suffix, so commands work bare (`today`) or slashed (`/today@MyBot`) — the deterministic ones need no AI key.

### 4. Free text → a resolved action (`handleFreeText`)

1. Gate on `isAnthropicConfigured()`; if the AI key is missing, reply pointing to the deterministic commands.
2. Load the roster in one `$transaction`: active `officers` (`OFFICER` + `DISPATCHER`), `partners` (only `SUBCONTRACTOR` / `BOTH`), active `sites`, active `customers`. Sites are mapped to a search context carrying `name`, `code`, `postcodeFormatted`, and a combined `address` (line + city).
3. `routeMessage(text, {officers, partners, nowUk})` returns a `RoutedMessage` discriminated union (see §AI tool-calling).
4. Dispatch by `kind`:
   - `error` → soft "couldn't read that" reply.
   - `help` → canned capability blurb.
   - **Officer branch** (`!isStaff`): `closeJob` → `handleOfficerCompletion`; `list` → `myDayMessage`; anything else → canned "other actions are for dispatch".
   - `lookupSite` / `lookupKey` → lookup messages.
   - `reassignJob` / `cancelJob` / `closeJob` → `handleJobActionRequest`.
   - `list` → `nowMessage` (day = `now`) or `dayRundownMessage` with an optional resolved scope.
   - `create` → `resolveCallout` → draft + confirm card.

### 5. Create-callout flow (the canonical draft/confirm path)

1. `resolveCallout(parsed, ctx)` (**pure**) coerces type/source/priority defaults, matches the site and handler (officer or partner) against the roster, parses any `scheduledFor` via `parseUkDateTimeLocal`, and **always** builds a `summary`. It returns `{ok:true, data}` only when there are zero problems; otherwise `{ok:false, problems[]}` which the webhook lists back to the user.
2. On success the webhook persists a `TelegramCalloutDraft` (payload = `BotCalloutData` with `scheduledFor` serialised to ISO) and sends the confirm card with **✅ Confirm / ✖️ Cancel** buttons (`calloutConfirmData` / `calloutCancelData`), then stores the returned `messageId`.
3. **Confirm** (`handleCalloutCallback`): re-loads the draft, checks `status === PENDING` and not expired, re-checks the tapper is linked staff, re-hydrates the `Date`, and calls `createBotCallout`.
4. `createBotCallout` (`callouts.ts`) **re-validates every id against the DB** (site active, officer active, partner is `SUBCONTRACTOR`/`BOTH`), writes the `Job` at `ASSIGNED` (someone's on it) or `OPEN`, creates an `AlarmEvent` (`source = MANUAL`) for `ALARM_RESPONSE`, snapshots billing + officer pay, and fires `notifyAlarmReceived` + `notifyAssignedOfficerOfJob`. The card is edited in place to the result.
5. **Cancel** flips the draft to `CANCELLED` and edits the card. Expired/terminal taps get an "already handled" edit.

### 6. Job actions (reassign / cancel / close) ride the same rails

`handleJobActionRequest` resolves the site, narrows candidate jobs by an optional `typeHint` (`mapTypeHint`), and — on a single unambiguous match — stages a draft whose payload carries `{kind}`. On **Confirm**, `handleCalloutCallback` branches on `payload.kind` to run `reassignJobCore` / `cancelJobCore` / `closeJobCore` / `completeVisitCore`. Zero matches → "nothing open"; multiple → the bot lists them and asks for the type. **Close** spans both jobs *and* patrol/VPI visits (`findCloseTargets` unions `Job` + `PatrolVisit`); reassign and cancel act on jobs only.

### 7. Officer self-report (no confirm card)

A bare past-tense message ("Norbury unlocked", "Croydon patrolled") routes to the `close_job` tool → `handleOfficerCompletion`. `findCloseTargets` is scoped to `ownerOfficerId = who.id`, and a single match is completed **immediately** (`closeJobCore` / `completeVisitCore`) with no confirmation — it's the officer reporting their own work. Ambiguity is resolved by re-asking.

### 8. Officer assignment ping + buttons

`notifyAssignedOfficerOfJob` (`telegramNotify.ts`) DMs the assignee a card with **✅ On site / 🏁 Complete** (`jobActionData("onsite"|"complete", jobId)`). `handleJobActionCallback`:
- Only the assignee (or staff) may act; cancelled/already-done jobs answer accordingly.
- **On site** → `startedAt` + `status = IN_PROGRESS`, edits the card to leave only **Complete**, then prompts for location.
- **Complete** → `startedAt`/`completedAt` + `status = APPROVED`, appends a "Completed via Telegram by …" audit note, calls `snapshotJobFinanceIfNeeded`, then prompts for location.

### 9. Location share

`promptForLocation` sets `User.pendingLocationJobId` and sends a one-tap **📍 Share location / Skip** reply keyboard (`requestLocation`). A shared location arrives as a `message.location`; `handleLocationShare` stamps `Job.lat/lng/locatedAt` **only if** the pending job is assigned to the sharer, then clears `pendingLocationJobId` and removes the keyboard. Typing "skip" clears the pending job.

### 10. Schedule queries

`resolveDayTarget` maps the day keyword/date to a UK calendar target; `resolveScope` optionally narrows to a site/customer/partner; `loadDayActivities` merges non-cancelled jobs + visits + shifts **anchored on their scheduled date** (`lib/activityWhen`, not `createdAt`); `formatDayActivitiesMessage` renders HTML capped at `MAX_ROWS = 40`. `day = "now"` instead runs `loadNowSnapshot` (in-progress + overdue-today) via `nowMessage`.

### AI tool-calling (`anthropic.ts` → `extractWithTools`)

- One `POST` to `https://api.anthropic.com/v1/messages` (`anthropic-version: 2023-06-01`), `model = ANTHROPIC_MODEL || "claude-sonnet-5"`, `max_tokens 1024`.
- Eight tools are offered with `tool_choice: {type:"any"}`, which **forces exactly one tool call**. The wrapper returns `{ok:true, name, data:input}` (the tool name + its JSON input) or `{ok:false, error}`.
- `routeMessage` maps the returned tool name to the `RoutedMessage` union:

| Tool | `RoutedMessage.kind` | Purpose |
|---|---|---|
| `create_callout` | `create` | New callout (full `ParsedCallout`). |
| `list_activities` | `list` | Schedule; `day` + optional `scopeQuery`. |
| `lookup_site` | `lookupSite` | Site search. |
| `lookup_key` | `lookupKey` | Key holder lookup. |
| `reassign_job` | `reassignJob` | Move a job to another officer. |
| `cancel_job` | `cancelJob` | Cancel a job. |
| `close_job` | `closeJob` | Mark an activity done (incl. bare past-tense reports). |
| `smalltalk_or_help` | `help` | Greetings / capability. |

The system prompt (`buildSystemPrompt`) injects the current UK date/time (`ukNowString()`) and the known officer/partner names, and instructs the model to copy site references *verbatim* into `siteQuery` (never invent a full name) and to emit explicit dates as ISO `YYYY-MM-DD`.

### Site-search scoring (`matchSite`)

1. Normalise (lowercase, strip punctuation, collapse spaces).
2. **Exact code** with a single hit → `one`. Then **exact name** single hit → `one`.
3. Otherwise **token scoring**: each whitespace-separated query word that appears *anywhere* in the site "haystack" (name + code + address + postcode, stored both spaced and un-spaced so `br1` and `br13ab` both hit) scores 1. The best-scoring sites survive; a single top scorer → `one`; ties → `many` (sorted so name-hits precede address-only hits). Score 0 → `none`.

`matchPerson` is substring either direction (query in name or name in query). `matchAccount` (used by `resolveScope`) is the same but **prefers the shortest name** (so "Shurgard" beats "Shurgard Storage London").

### Natural-language date parsing (`parseUkDateString`)

Handles the formats a UK dispatcher actually types, all validated by `validYmd` (a round-trip that rejects e.g. 31 Feb), defaulting a missing year to the current UK year:
- ISO `YYYY-MM-DD`
- Day-first numeric `DD/MM[/YYYY]` with `/`, `.`, or `-`
- Spoken `"3 August [2026]"` / `"august 3"`, ordinals stripped (`3rd → 3`)

Relative phrasing ("tonight", "9pm", "in an hour") is resolved by the **model** (using the injected UK now) into a wall-clock `YYYY-MM-DDTHH:MM`, then parsed by `parseUkDateTimeLocal`.

### The 64-byte `callback_data` constraint

Telegram caps inline-button `callback_data` at **64 bytes**. The encoders keep well under it with a 3-char tag + `:` + a single UUID (~40 bytes total), so no packing or lookup table is needed:

| Helper | Encodes | Regex decode |
|---|---|---|
| `calloutConfirmData` / `calloutCancelData` | `coc:<draftId>` / `cox:<draftId>` | `decodeCalloutAction` → `^co([cx]):(.+)$` |
| `jobActionData("onsite"\|"complete", …)` | `jco:<jobId>` / `jcd:<jobId>` | `decodeJobAction` → `^jc([od]):(.+)$` |

The `POST` handler routes a tap by trying `decodeJobAction` first (officer buttons) and falling back to `handleCalloutCallback` (confirm cards).

## Business rules & invariants

- **Fail-closed auth**: no `TELEGRAM_WEBHOOK_SECRET` → every update is rejected.
- **Nothing hits the live board until Confirm.** Drafts are inert; only `createBotCallout` / the job-action cores mutate.
- **Draft idempotency**: a confirm/cancel is a no-op unless `status === PENDING` and `expiresAt` is in the future; terminal drafts render an "already handled/expired" edit.
- **Who may act**: only linked *staff* on the chat may confirm a callout or job-action card; officer On-site/Complete buttons require the *assignee* (or staff).
- **One chat ↔ one account** (enforced by unique `telegramChatId` + the detach-on-link transaction).
- **Officer self-report needs no confirm**; every staff mutation is confirmed (deterministic *reads* aside).
- **Scope**: `close_job` spans jobs + patrol/VPI visits; `reassign_job` / `cancel_job` act on jobs only. A partner handler must be `SUBCONTRACTOR` or `BOTH`. `ALARM_RESPONSE` always creates an `AlarmEvent`.
- **Re-validation**: because a draft can go stale, `createBotCallout` re-checks every id against the DB before writing.
- Lookups never surface access codes over chat (`telegramLookup.ts`).

## Entry points

- **`POST /api/telegram/webhook`** — the sole inbound entry (Telegram → us).
- **`/telegram`** (`requireStaff`) — `ConnectTelegram` (link/unlink), and for admins `WebhookSetup` (register/check the webhook).
- **Server actions** (`(app)/telegram/_actions.ts`): `generateTelegramLinkCode`, `registerTelegramWebhook` (also publishes `BOT_COMMANDS` via `setMyCommands`), `checkTelegramWebhook`, `disconnectTelegram`.
- **Outbound pings** originate from `createBotCallout`, `reassignJobCore` (`telegramNotify.notifyAssignedOfficerOfJob`), and the broadcast helpers in `telegramNotify.ts` — see `10-notifications.md`.

## Extension points & gotchas

- **No SDKs.** `telegram.ts` and `anthropic.ts` are hand-rolled `fetch` wrappers, deliberately, so a serverless webhook survives cold starts without a reinstall. Add Bot API methods by calling the private `call(method, body)`.
- **`allowed_updates` is limited to `message` + `callback_query`.** To handle edited messages, inline queries, etc., widen it in `setWebhook` *and* add a branch in `POST`.
- **`drop_pending_updates: true`** on register: re-registering the webhook discards any queued backlog.
- **HTML parse mode everywhere.** All user-derived text must pass through `escapeHtml` (which escapes only `&`, `<`, `>`). Forgetting it will break rendering on names with `<`/`&`.
- **No draft cleanup cron.** `expiresAt` is indexed but nothing sweeps `CONFIRMED`/`CANCELLED`/expired `TelegramCalloutDraft` rows — they accumulate. A rebuild should add a sweep (see `13-crons.md`).
- **Model id `"claude-sonnet-5"`** is the in-code default (`DEFAULT_MODEL`); override with `ANTHROPIC_MODEL`. Confirm the id against the current model catalogue before relying on it.
- **Stateless routing.** `routeMessage` is a single classification call with no conversation memory — there is no multi-turn slot-filling; ambiguity is always resolved by re-asking, not by threading context.
- **Deterministic commands work without the AI key**; only the free-text path is gated on `ANTHROPIC_API_KEY`.
- **The officer surface hard-codes** which `RoutedMessage` kinds officers may use (`closeJob`, `list`); everything else returns a canned reply. Widen `handleFreeText`'s officer branch to grow it.

### Env vars

| Var | Used for |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Send/receive (from @BotFather). |
| `TELEGRAM_BOT_USERNAME` | `t.me` deep links. |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook auth (echoed header). |
| `NEXTAUTH_URL` | Deriving the webhook URL. |
| `ANTHROPIC_API_KEY` | The free-text AI router. |
| `ANTHROPIC_MODEL` | Optional model override (default `claude-sonnet-5`). |
