# Notifications

> One `Notification` queue table feeds three transports — WhatsApp (Meta) and SMS (SMS Works) are drained by per-minute crons, while Telegram is a fire-and-forget broadcast sent inline; domain helpers funnel every event through `queueAll` (WhatsApp + Telegram) or `queueSms*` (SMS), and dedup keeps cron-driven reminders from re-firing.

## Purpose & scope

The unified outbound-notification system in `src/lib/notifications.ts` plus its three provider clients. Covers:

- The `Notification` queue model and its `PENDING → SENT/FAILED/SKIPPED` lifecycle.
- The two funnels: `queueAll` (WhatsApp rows **and** a Telegram broadcast) and `queueSms` / `queueSmsOnce` (SMS rows).
- Domain helpers (`notifyVisitStarted`, `…Completed`, `…LateOrMissed`, `notifyAlarmReceived`, `notifyShiftCheckOverdue`, `notifyKeyHandover`; `notifyShiftReminder`, `…JobReminder`, `…OfficerNoShow`, `…AlarmCustomerAck`, `…OfficerPaySummary`, `notifyMissedCall`).
- The Telegram broadcast layer (`broadcastToLinkedStaff`, `notifyDispatchTelegram`, `alertMissedCallTelegram`, `alertNoShowTelegram`, `alertPartnerUpdateDueTelegram`, `notifyAssignedOfficerOfJob`).
- The generic `drainQueue` and the channel-specific crons that call it.
- Dedup patterns (`queueSmsOnce`; the `SHIFT_CHECK_OVERDUE` marker row; composite `eventEntityId`).

Out of scope: the **inbound** Telegram bot (webhook, AI callout parsing) — see the Telegram bot module and `src/lib/telegram.ts` / `telegramCallout.ts`. Client-report emails to customers do **not** go through this queue (the `EMAIL` channel is unused here). Cron mechanics and schedules live in [`13-crons.md`](./13-crons.md).

## Data model

`model Notification` (`prisma/schema.prisma:1185`):

| Column | Type | Meaning |
|---|---|---|
| `channel` | `NotificationChannel` (`@default WHATSAPP`) | Which drainer owns the row. |
| `kind` | `NotificationKind` | The domain event. |
| `recipientUserId` / `recipientUser` | `String? @db.Uuid` / rel `SetNull` | The staff/officer recipient (null for external numbers, e.g. customers). |
| `recipientNumber` | `String?` | Destination E.164. No number → drainer `SKIPPED`. |
| `templateName` | `String` | WhatsApp: the Meta template name. SMS: stores the `kind` for traceability. |
| `templateParams` | `Json @default "[]"` | WhatsApp `{{1}}…{{n}}` body params. |
| `bodyPreview` | `String?` | Human-readable line (also the Telegram broadcast body). |
| `bodyText` | `String?` | Plain-text SMS body (WhatsApp rows render from template instead). |
| `status` | `NotificationStatus` (`@default PENDING`) | Lifecycle (below). |
| `attempts` | `Int @default 0` | Incremented on every drainer touch. |
| `error` | `String?` | Failure/skip reason (sliced to 1000 chars). |
| `eventEntity` / `eventEntityId` | `String?` | Source row, e.g. `("Shift", <id>)` — the dedup key. |
| `sentAt` | `DateTime?` | Stamped on `SENT`. |

Indexes: `[status, createdAt]` (drainer scan), `[recipientUserId]`, `[eventEntity, eventEntityId]` (dedup lookup), `[kind]`.

### Enums

- **`NotificationChannel`** — `WHATSAPP`, `EMAIL`, `SMS`. **`EMAIL` is defined but unused by the queue** (no drainer handles it).
- **`NotificationStatus`** — `PENDING`, `SENT`, `FAILED`, `SKIPPED`.
- **`NotificationKind`** (14): `VISIT_STARTED`, `VISIT_COMPLETED`, `VISIT_LATE`, `VISIT_MISSED`, `ALARM_RECEIVED`, `KEY_HANDOVER`, `SHIFT_CHECK_OVERDUE`, `SHIFT_REMINDER`, `JOB_REMINDER`, `OFFICER_NO_SHOW`, `ALARM_CUSTOMER_ACK`, `PAY_SUMMARY`, `SHIFT_LINK`, `MISSED_CALL`.

Recipient contact columns live on `User`: `whatsappNumber`, `phone`, `telegramChatId @unique` (see [`02-access-auth-roles.md`](./02-access-auth-roles.md)).

## Key files

| File | Responsibility |
|---|---|
| `src/lib/notifications.ts` | Queue model logic: `queueAll`, `queueSms`, `queueSmsOnce`, all domain helpers, and `drainQueue`. |
| `src/lib/whatsapp.ts` | Meta WhatsApp Cloud API v21.0 client: `sendTemplate`, `isWhatsAppConfigured`, `normaliseE164`. |
| `src/lib/sms.ts` | SMS Works REST client: `sendSms`, `isSmsConfigured`, `normaliseE164`. |
| `src/lib/telegramNotify.ts` | DB-touching Telegram broadcasts + the assigned-officer DM. |
| `src/lib/telegram.ts` | Pure Bot API wrapper (`sendTelegramMessage`, `isTelegramConfigured`, HTML escaping). |
| `src/app/api/cron/whatsapp-queue/route.ts` | Per-minute `drainQueue()` (WhatsApp). |
| `src/app/api/cron/sms-queue/route.ts` | Per-minute `drainQueue("SMS")`. |

## Core flows / mechanics

### Two funnels

```
Domain event
   │
   ├─ queueAll(...)                         (dispatch-facing events)
   │     ├─ notifyDispatchTelegram(kind, bodyPreview)   → Telegram broadcast (always, fire-and-forget)
   │     └─ Notification.createMany(channel=WHATSAPP, status=PENDING, one per recipient)
   │
   └─ queueSms / queueSmsOnce(...)          (SMS-first events)
         └─ Notification.createMany(channel=SMS, status=PENDING, one per recipient)

Cron /api/cron/whatsapp-queue  → drainQueue("WHATSAPP") → sendTemplate → SENT/FAILED/SKIPPED
Cron /api/cron/sms-queue       → drainQueue("SMS")      → sendSms      → SENT/FAILED/SKIPPED
```

**`queueAll` (`notifications.ts:73`)** — the WhatsApp funnel, but it **also broadcasts to Telegram unconditionally**. It first fires `notifyDispatchTelegram(kind, bodyPreview)` (caught, never blocks), then — only if there are WhatsApp recipients — writes one `PENDING` `WHATSAPP` row per recipient. So a fully-unconfigured WhatsApp setup still gets Telegram alerts, and configured WhatsApp adds the templated message on top.

**`queueSms` / `queueSmsOnce`** — SMS funnel, **no Telegram side-effect**. Writes `PENDING` `SMS` rows with `bodyText` + `bodyPreview` (240 chars). `queueSmsOnce` is the idempotent variant (see dedup).

### Domain helpers

**Via `queueAll` (WhatsApp row + Telegram broadcast).** Recipients = `staffRecipients()` = active `ADMIN`/`DISPATCHER` with a `whatsappNumber`.

| Helper | Kind | WhatsApp template | Recipients |
|---|---|---|---|
| `notifyVisitStarted(visitId)` | `VISIT_STARTED` | `visit_started` | staff |
| `notifyVisitCompleted(visitId)` | `VISIT_COMPLETED` | `visit_completed` | staff |
| `notifyVisitLateOrMissed(visitId, "LATE"\|"MISSED")` | `VISIT_LATE` / `VISIT_MISSED` | `visit_late` / `visit_missed` | staff |
| `notifyAlarmReceived(alarmEventId)` | `ALARM_RECEIVED` | `alarm_received` | staff |
| `notifyShiftCheckOverdue(shiftId)` | `SHIFT_CHECK_OVERDUE` | `shift_check_overdue` | staff |
| `notifyKeyHandover(movementId)` | `KEY_HANDOVER` | `key_handover` | staff **+ from/to officer** of the movement (deduped by user id) |

**Via `queueSms*` (SMS row).** All use `queueSmsOnce` → idempotent per entity.

| Helper | Kind | Recipient | `eventEntity(Id)` |
|---|---|---|---|
| `notifyShiftReminder(shiftId)` | `SHIFT_REMINDER` | shift's officer (`phone`) | `Shift` |
| `notifyJobReminder(jobId)` | `JOB_REMINDER` | job's `assignedTo` (`phone`, needs `scheduledFor`) | `Job` |
| `notifyOfficerNoShow({entity, entityId})` | `OFFICER_NO_SHOW` | `dispatcherSmsRecipients()` (active ADMIN/DISPATCHER w/ `phone`) | `Shift` or `Job` |
| `notifyAlarmCustomerAck(jobId)` | `ALARM_CUSTOMER_ACK` | `customer.contactPhone`, **gated on `customer.smsAlertsOn`** | `Job` |
| `notifyOfficerPaySummary({officerId, monthLabel, activities, totalPay})` | `PAY_SUMMARY` | officer's `phone` | `User` / **`<officerId>:<YYYY-MM>`** |
| `notifyMissedCall(callEventId)` | `MISSED_CALL` | `dispatcherSmsRecipients()`; fires 24/7 | `CallEvent` |

**`SHIFT_LINK` is special** — not produced by a helper here. `src/app/(app)/shifts/_actions.ts` (`sendShiftLink`) sends the `/duty/<token>` link via `sendSms` **synchronously**, then writes a `SHIFT_LINK` SMS row already stamped `SENT`/`FAILED` (never `PENDING`). The drainer therefore ignores it; the row is an audit record, not a queued job. (Duty token: [`02-access-auth-roles.md`](./02-access-auth-roles.md).)

### Telegram broadcast layer (`src/lib/telegramNotify.ts`)

Every function is fire-and-forget and self-guarding (no-op when `!isTelegramConfigured()`), so callers can `.catch(() => {})`.

- **`broadcastToLinkedStaff(text)`** — DMs every active `ADMIN`/`DISPATCHER` with a `telegramChatId`; returns count. HTML parse mode.
- **`notifyDispatchTelegram(kind, body)`** — the single funnel called by `queueAll`. Maps `kind` → emoji + heading via `DISPATCH_ALERT_META` (🟢 started, ✅ completed, 🟠 late, 🔴 missed, 🚨 alarm, ⚠️ check overdue, 🔑 key handover; fallback 🔔 "Update"), then broadcasts.
- **`alertMissedCallTelegram(callEventId)`** — 📞 Missed call. Fired alongside `notifyMissedCall` from `src/lib/bonlineWebhook.ts`.
- **`alertNoShowTelegram(entity, entityId)`** — 🔴 No-show. Fired alongside `notifyOfficerNoShow` from the `shift-checks` cron.
- **`alertPartnerUpdateDueTelegram(jobId)`** — 📞 "Chase `<partner>` for an update" for partner-subcontracted jobs with no automatic completion. Re-sent every ~15 min by `shift-checks` until the job closes or a `partnerReportRef` is logged; paced by `Job.lastPartnerChaseAt`. (Partner mode 3: [`08-partners.md`](./08-partners.md).)
- **`notifyAssignedOfficerOfJob(jobId)`** — targets the **assigned officer** (not dispatch): DMs `job.assignedTo.telegramChatId` with inline "✅ On site" / "🏁 Complete" buttons (`callback_data` from `jobActionData`). Called on assignment from `dispatch/_actions.ts`, `lib/callouts.ts`, `lib/jobActions.ts`.

### The drainer (`drainQueue`, `notifications.ts:543`)

`drainQueue(channel = "WHATSAPP", maxBatch = 50)`:

1. Select `Notification` where `status = PENDING` **and** `channel = <channel>`, `orderBy createdAt asc`, `take maxBatch`. Channel filter keeps WhatsApp and SMS retries from bleeding into each other.
2. **Provider unconfigured** (`!isWhatsAppConfigured()` / `!isSmsConfigured()`): mark every scanned row `SKIPPED` with a clear `error` (which env var is missing), `attempts++`, return.
3. Per row:
   - No `recipientNumber` → `SKIPPED`.
   - `WHATSAPP` → `sendTemplate({ to, templateName, bodyParams: templateParams.map(String) })`.
   - `SMS` → `body = bodyText ?? bodyPreview`; empty → `SKIPPED`; else `sendSms({ to, body })`.
   - Success → `SENT` + `sentAt` + `attempts++` + `error: null`.
   - Failure → `FAILED` + `error` (sliced 1000) + `attempts++`.
4. Returns `{ scanned, sent, failed, skipped }`.

### Providers

| Provider | File | Transport | Config gate |
|---|---|---|---|
| WhatsApp | `src/lib/whatsapp.ts` | Meta Cloud API **v21.0**, `POST graph.facebook.com/{ver}/{phoneId}/messages`, **template messages only** (required outside a 24-h customer session), lang default `en_GB`. | `WHATSAPP_PHONE_ID` + `WHATSAPP_ACCESS_TOKEN`. |
| SMS | `src/lib/sms.ts` | SMS Works REST `POST api.thesmsworks.co.uk/v1/message/send`, content capped 1600. Sender = `SMS_WORKS_SENDER` (default `"1NW"`). Exported surface matches the retired Twilio driver. | `SMS_WORKS_JWT`. |
| Telegram | `src/lib/telegram.ts` | Bot API REST, free, HTML parse mode. | `TELEGRAM_BOT_TOKEN`. |

Both `whatsapp.ts` and `sms.ts` export a `normaliseE164` that accepts UK `07…` (→ `+44…`) and strict `+…` E.164.

### Which event goes to which channel

| Kind | WhatsApp (queued) | Telegram (inline broadcast) | SMS (queued) | Fired from |
|---|:--:|:--:|:--:|---|
| `VISIT_STARTED` | ✅ | ✅ | — | `POST /api/visits/[id]/on-site` |
| `VISIT_COMPLETED` | ✅ | ✅ | — | `POST /api/submissions`, `lib/jobActions.ts` |
| `VISIT_LATE` / `VISIT_MISSED` | ✅ | ✅ | — | `visit-statuses` cron |
| `ALARM_RECEIVED` | ✅ | ✅ | — | `dispatch/_actions.ts`, `lib/callouts.ts` |
| `SHIFT_CHECK_OVERDUE` | ✅ | ✅ | — | `shift-checks` cron |
| `KEY_HANDOVER` | ✅ | ✅ | — | `keys/_actions.ts` |
| `SHIFT_REMINDER` | — | — | ✅ (→officer) | `upcoming-reminders` cron |
| `JOB_REMINDER` | — | — | ✅ (→officer) | `upcoming-reminders` cron |
| `OFFICER_NO_SHOW` | — | ✅ (`alertNoShowTelegram`) | ✅ (→dispatch) | `shift-checks` cron |
| `MISSED_CALL` | — | ✅ (`alertMissedCallTelegram`) | ✅ (→dispatch) | `lib/bonlineWebhook.ts` (bOnline call) |
| `ALARM_CUSTOMER_ACK` | — | — | ✅ (→customer) | `admin/reports/_actions.ts` (approve) |
| `PAY_SUMMARY` | — | — | ✅ (→officer) | `pay-summary` cron |
| `SHIFT_LINK` | — | — | ✅ immediate, not queued (→officer) | `shifts/_actions.ts` |
| *(no row)* Assigned-officer job DM | — | ✅ (→officer, w/ buttons) | — | on assignment |
| *(no row)* Partner update chase | — | ✅ (→dispatch) | — | `shift-checks` cron |
| *(no row)* Morning brief | — | ✅ (→dispatch) | — | `telegram-brief` cron |

## Business rules & invariants

- **Notifications never block a response.** Domain helpers are awaited best-effort inside their callers but always `.catch(...)`; Telegram sends are pure fire-and-forget.
- **Status lifecycle is one-way:** `PENDING → SENT | FAILED | SKIPPED`. The drainer only ever selects `PENDING`, so **`FAILED` rows are not auto-retried** — they are a dead record. (`queueSmsOnce` treats `FAILED` as "absent", so a *new* `PENDING` row can be created for the same entity.)
- **`SKIPPED` means "provider off or unusable input"**, not a delivery failure — used so an unconfigured WhatsApp/SMS setup doesn't pile up `PENDING` rows forever.
- **Recipient resolution is always live** from `User` (active + has the relevant contact column). No contact number → no row for that recipient.
- **WhatsApp requires pre-approved templates**; free-text WhatsApp is impossible outside a 24-h session, hence `templateName` + `templateParams`. See `docs/whatsapp-setup.md`.
- **Telegram requires the user to have started the bot** (chat id captured at link time); an unlinked staff member silently receives nothing.

### Dedup patterns

1. **`queueSmsOnce`** — skips if a row with the same `kind` + `eventEntity` + `eventEntityId` and `status NOT IN (FAILED)` already exists. Makes cron re-runs safe.
2. **Composite `eventEntityId`** — `PAY_SUMMARY` uses `<officerId>:<YYYY-MM>` so each officer is texted at most once per month even across re-runs.
3. **`SHIFT_CHECK_OVERDUE` marker row** — the `shift-checks` cron's overdue gate looks for a `SHIFT_CHECK_OVERDUE` row newer than the last check-in. When `queueAll` wrote **no** WhatsApp row (no WhatsApp recipients configured) there'd be nothing to gate on, so the cron inserts a `SKIPPED` row (`bodyPreview: "Telegram-only overdue check-in marker"`) to hold the Telegram broadcast to once per overdue window. When WhatsApp rows exist, they serve as the marker.
4. **Caller-side gates for Telegram-only alerts** — `Job.lastPartnerChaseAt` (partner chase cadence), a `CallEvent.alerted` flag, or a status flip ensure each Telegram broadcast goes exactly once; dedup is the caller's responsibility because Telegram writes no row.

## Entry points

- **Producers:** the domain helpers above, called from API routes, server actions, and crons (see the channel table's "Fired from" column and [`13-crons.md`](./13-crons.md)).
- **Consumers (drainers):** `GET /api/cron/whatsapp-queue` → `drainQueue()`; `GET /api/cron/sms-queue` → `drainQueue("SMS")`. Both gated by `CRON_SECRET`.
- **Telegram broadcasts:** sent inline at event time; no queue, no cron consumer (except the `telegram-brief` morning digest, which is itself a cron *producer*).
- **Admin view:** the notifications queue is surfaced under `/admin/notifications` for inspecting `PENDING`/`FAILED`/`SKIPPED` rows.

## Extension points & gotchas

- **Adding a `NotificationKind`:** extend the enum (+migration), add a domain helper (`queueAll` for dispatch-facing, `queueSms*` for SMS), add a `DISPATCH_ALERT_META` entry if it should read nicely on Telegram (else it falls back to 🔔 "Update"), and register a WhatsApp template if `queueAll`. Forgetting the template makes every WhatsApp row `FAILED` at Meta while Telegram still works.
- **`queueAll` always hits Telegram** even when you think you're "only" queuing WhatsApp — factor that in when adding recipients or you'll double-notify dispatch.
- **`EMAIL` channel is a stub** — nothing drains it. Client emails are a separate subsystem; don't route them through `Notification` expecting delivery.
- **No automatic retry of `FAILED`.** If you need retry, either re-`PENDING` the row (a small admin action) or design the caller to re-queue via `queueSmsOnce` (which ignores `FAILED`). Don't assume the per-minute cron will pick a `FAILED` row back up.
- **Idempotency depends on stable `eventEntityId`.** A helper that queues with a `new Date()`-derived or otherwise varying id defeats `queueSmsOnce` — keep the id tied to the source row (or a stable composite like the pay-summary month key).
- **`maxBatch = 50` per minute per channel** — a burst larger than 50 drains over successive minutes (ordered oldest-first). Raise `maxBatch` or the cron cadence if volume grows.
- **Provider config is checked at drain time, not queue time** — rows queue fine before Meta/SMS Works is set up, then flip to `SKIPPED` with a diagnostic once the drainer runs. Watch `attempts`/`error` when debugging "nothing sent".
