# Scheduled jobs (crons)

> Eleven Vercel Cron routes under `src/app/api/cron/*` — they materialise schedules into work, sweep statuses to LATE/MISSED, drain the WhatsApp and SMS queues every minute, chase partners and check-ins every 15 minutes, chase overdue invoices daily, and send reminders/briefs/pay summaries — each a `GET` gated by `CRON_SECRET`.

## Purpose & scope

Everything driven by the clock rather than a user. Covers the `crons` array in `vercel.json`, each route in `src/app/api/cron/*/route.ts`, and the shared auth guard `src/lib/cronAuth.ts`. For what the drainers actually send, see [`10-notifications.md`](./10-notifications.md); for the schedule/visit/shift models they read and write, see [`01-data-model.md`](./01-data-model.md); for the partner-chase logic (mode 3), see [`08-partners.md`](./08-partners.md); for `CRON_SECRET` and Vercel cron plan limits, see [`15-deployment-and-ops.md`](./15-deployment-and-ops.md).

## Timezone & auth (read first)

- **All Vercel cron schedules are UTC.** Daily times below are UTC, so their UK wall-clock drifts one hour with BST (e.g. `telegram-brief` at `0 7 * * *` = 07:00 UTC ≈ 07:00–08:00 UK). Business logic that needs UK days/times uses `src/lib/dates.ts` and the UK-day helpers, **not** server-local time (see [`14-conventions-and-ui.md`](./14-conventions-and-ui.md)).
- **Auth: `isAuthorisedCron(req)`** (`src/lib/cronAuth.ts`). Vercel sends `Authorization: Bearer <CRON_SECRET>`; the guard returns `true` only on an exact match. If `CRON_SECRET` is unset it returns `true` **only when `NODE_ENV !== "production"`** — so you can `curl` endpoints by hand in dev, but production without the secret rejects everything. Every route returns `401 { error: "Unauthorised" }` when the guard fails.
- All cron routes are **`GET`** handlers and are excluded from the auth middleware matcher path-gating (they carry their own secret). Several accept query overrides (`?date=`, `?force=`) that remain `CRON_SECRET`-gated, so they are not externally callable.

## The schedule

| Path | Schedule (UTC) | Cadence | What it does | Key side effects |
|---|---|---|---|---|
| `/api/cron/patrol-visits` | `5 0 * * *` | daily 00:05 | Materialise `PatrolVisit`s from active `PatrolSchedule`s for today + tomorrow (UK). | Inserts `PatrolVisit` rows (idempotent). |
| `/api/cron/lockunlock-jobs` | `10 0 * * *` | daily 00:10 | Materialise lock/unlock `Job`s from active `LockUnlockSchedule`s for today + tomorrow (UK). | Inserts `LOCK`/`UNLOCK` `Job` rows (idempotent). |
| `/api/cron/visit-statuses` | `0 * * * *` | hourly | Flip overdue visits `PENDING→LATE` (>1 h) and `PENDING/LATE/IN_PROGRESS→MISSED` (>24 h). | Status updates (in a tx) + `VISIT_LATE`/`VISIT_MISSED` notifications. |
| `/api/cron/blob-cleanup` | `0 3 * * *` | daily 03:00 | Delete Vercel Blob media older than 180 days under `uploads/`. | Permanent blob deletion; submissions keep dead URLs. |
| `/api/cron/whatsapp-queue` | `* * * * *` | every minute | `drainQueue()` — send `PENDING` WhatsApp rows via Meta. | `Notification` rows → `SENT`/`FAILED`/`SKIPPED`. |
| `/api/cron/sms-queue` | `* * * * *` | every minute | `drainQueue("SMS")` — send `PENDING` SMS rows via SMS Works. | `Notification` rows → `SENT`/`FAILED`/`SKIPPED`. |
| `/api/cron/shift-checks` | `*/15 * * * *` | every 15 min | **Three sweeps**: shift/job no-shows → `MISSED`; overdue in-progress check-ins; partner-update chase. | `Shift`→`MISSED`; `OFFICER_NO_SHOW`/`SHIFT_CHECK_OVERDUE` notifications; Telegram no-show + partner-chase; stamps `Job.lastPartnerChaseAt`. |
| `/api/cron/telegram-brief` | `0 7 * * *` | daily 07:00 | Broadcast today's schedule to linked dispatch on Telegram. | Telegram DMs (no DB writes). |
| `/api/cron/upcoming-reminders` | `*/5 * * * *` | every 5 min | Text officers about shifts/jobs starting in 30–60 min. | `SHIFT_REMINDER`/`JOB_REMINDER` SMS rows (deduped). |
| `/api/cron/pay-summary` | `0 9 1 * *` | 1st of month 09:00 | Text each active officer their prior-month pay total. | `PAY_SUMMARY` SMS rows (one per officer/month). |
| `/api/cron/invoice-reminders` | `0 8 * * *` | daily 08:00 | Email customers whose `SENT` invoices have crossed an overdue threshold (1/7/14/30 days), highest unsent stage only. | Reminder emails + `InvoiceReminder` rows (one per invoice/stage). No-op until email is configured. |

## Per-cron mechanics

### `patrol-visits` (`5 0 * * *`)
Thin wrapper over `materializePatrolVisits({ anchor, offsets })` in `src/lib/scheduleSync.ts`. Default: `anchor = now`, `offsets = [0, 1]` (today **and** tomorrow in UK terms, giving dispatch a day-ahead view). `?date=YYYY-MM-DD` sets `offsets = [0]` for a single-day back-fill without spilling into tomorrow; an unparseable date → `400`. The same lib function backs the dispatcher's "Sync schedules" button, so cron and button share one code path. Materialisation is idempotent (re-running does not duplicate visits).

### `lockunlock-jobs` (`10 0 * * *`)
Wrapper over `materializeLockUnlockJobs` (same `anchor`/`offsets` semantics and `?date=` override). For each UK day it loads active `LockUnlockSchedule`s whose `days` array contains that weekday, skips inactive sites, and for each schedule's `unlockTime` / `lockdownTime` calls `maybeCreateLockUnlock` to insert an `UNLOCK` / `LOCK` `Job` — carrying the site's `customerId`, `partnerId`, and `assignedOfficerId`. Returns per-day counts `{ createdUnlock, createdLock, skipped }`. Runs 5 min after `patrol-visits` to stagger the midnight load.

### `visit-statuses` (`0 * * * *`)
Hourly status sweep. Computes `lateCutoff = now − 1 h` and `missedCutoff = now − 24 h`, then:
- `PENDING` with `scheduledAt ∈ (missedCutoff, lateCutoff]` → **`LATE`**.
- `PENDING/LATE/IN_PROGRESS` with `scheduledAt ≤ missedCutoff` → **`MISSED`**.

It reads the to-flip ids **before** running the two `updateMany`s inside a `$transaction`, so it can then queue `notifyVisitLateOrMissed` for each affected visit (best-effort, per-item `.catch`). Those notifications go to the WhatsApp queue **and** broadcast to Telegram via `queueAll` ([`10-notifications.md`](./10-notifications.md)). Returns `{ flippedToLate, flippedToMissed }`.

### `blob-cleanup` (`0 3 * * *`)
180-day retention over Vercel Blob. Paginates `list({ prefix: "uploads/" })`, collects every blob with `uploadedAt < cutoff`, and deletes them via `del()` in chunks of ≤1000. Submissions that referenced a deleted blob keep the now-dead URL — an **intentional** broken-image signal that the media has aged out. Returns `{ scanned, deleted, cutoff }`.

### `whatsapp-queue` / `sms-queue` (`* * * * *`)
Both call the generic `drainQueue` with their channel (`drainQueue()` and `drainQueue("SMS")` respectively) — same `Notification` table, filtered by `channel` so retries don't bleed across providers. Up to 50 oldest `PENDING` rows per run. If the provider isn't configured, rows are marked `SKIPPED` with a diagnostic rather than left pending. Full drainer semantics: [`10-notifications.md`](./10-notifications.md).

### `shift-checks` (`*/15 * * * *`)
Does **three** things in one pass:

1. **Shift no-shows → `MISSED`.** Loads `PENDING` shifts with `scheduledStartsAt < now`; the per-row grace check (`scheduledStartsAt + graceMinutes`) is done in JS because grace varies per row. For each past-grace shift it queues `notifyOfficerNoShow` (SMS) **and** `alertNoShowTelegram` **before** flipping `status → MISSED`. Ordering matters: queuing before the flip means a notification failure leaves the shift `PENDING` for the next run to retry, and the flip drops the shift from the query so the alert fires exactly once (`queueSmsOnce` also dedupes).
   - **1b. Late jobs.** `APPROVED`/`SUBMITTED` jobs with an assignee, `startedAt = null`, and `scheduledFor < now − 15 min` → `notifyOfficerNoShow(Job)`; `alertNoShowTelegram(Job)` only fires when the SMS was freshly queued (`n > 0`), keeping the Telegram alert to once per job. No status flip — dedup is entirely via `queueSmsOnce`.
2. **Overdue in-progress check-ins.** For each `IN_PROGRESS` shift, `last = latest SHIFT_CHECK FormSubmission.submittedAt ?? actualStartedAt`; if `now ≥ last + (checkIntervalMin + graceMinutes)` and no `SHIFT_CHECK_OVERDUE` notification exists with `createdAt > last`, queue `notifyShiftCheckOverdue` (WhatsApp queue + Telegram). When that queues **no** WhatsApp row (no WhatsApp recipients configured), the cron inserts a `SKIPPED` "Telegram-only overdue check-in marker" row so the gate holds the Telegram broadcast to once per overdue window (dedup pattern 3 in [`10-notifications.md`](./10-notifications.md)).
3. **Partner-update chase (mode 3).** Jobs with `handledByPartnerId` set, `status ∈ {OPEN, ASSIGNED, IN_PROGRESS, SUBMITTED, REVIEW_PENDING}`, `completedAt = null`, `partnerReportRef = null`, `scheduledFor` null-or-past, and `lastPartnerChaseAt` null-or-`≤ now − 14 min` → `alertPartnerUpdateDueTelegram`, then stamp `lastPartnerChaseAt = now` **regardless of Telegram delivery**. The 14-min floor guarantees the `*/15` cron always re-clears it, so dispatch is nudged roughly every 15 min until the job closes/cancels/completes or a partner report reference is logged. Returns a rich `{ markedMissed, flagged, jobNoShowQueued, partnerChased, … }`.

### `telegram-brief` (`0 7 * * *`)
`runtime = "nodejs"`, `force-dynamic`. No-op when `!isTelegramConfigured()`. Builds `dayRundownMessage("today")` (`src/lib/dayActivities.ts`) and `broadcastToLinkedStaff` it under a `🌅 Morning brief` heading to every linked `ADMIN`/`DISPATCHER`. No DB writes.

### `upcoming-reminders` (`*/5 * * * *`)
Window `from = now + 30 min`, `to = now + 60 min`. In parallel: `PENDING` shifts with an officer and `scheduledStartsAt ∈ [from, to]` → `notifyShiftReminder`; `APPROVED`/`SUBMITTED` jobs with an assignee, `startedAt = null`, and `scheduledFor ∈ [from, to]` → `notifyJobReminder`. Both use the idempotent `queueSmsOnce` path (unique per `Shift`/`Job` id + kind), so the 30-min-wide window guarantees a 5-min cron texts each upcoming row **exactly once** even if a run is delayed.

### `pay-summary` (`0 9 1 * *`)
09:00 UTC on the 1st: sums the **prior calendar month** for each active `OFFICER`/`DISPATCHER` with a `phone`, across `PatrolVisit.paidAmount` (`COMPLETED`), `Job.paidAmount` (not `CANCELLED`, `completedAt` set), and `Shift.paidAmount` (`COMPLETED`). Crucially, month membership is by **scheduled** date via `visitScheduledRange` / `jobScheduledRange` / `shiftScheduledRange` (`src/lib/activityWhen.ts`) — never `createdAt` (see [`14-conventions-and-ui.md`](./14-conventions-and-ui.md)). Officers with zero activities and zero pay are skipped. `notifyOfficerPaySummary` queues a `PAY_SUMMARY` SMS with composite `eventEntityId = <officerId>:<YYYY-MM>` for month-level idempotency. `?force=YYYY-MM` overrides the month (for admin testing) and stays `CRON_SECRET`-gated.

## Business rules & invariants

- **Idempotency is the design principle.** Every cron is safe to re-run: materialisers de-dupe by natural key; status sweeps re-select only rows still in the pre-flip state; notification helpers use `queueSmsOnce` / marker rows / composite ids. This tolerates Vercel's "approximately on schedule, at least once" delivery.
- **Notify-before-mutate** in `shift-checks` (queue the alert, then flip to `MISSED`) so a delivery failure retries next run instead of silently dropping the alert.
- **Status thresholds:** visit `LATE` at +1 h, `MISSED` at +24 h; shift `MISSED` at `scheduledStartsAt + graceMinutes`; check-in overdue at `lastCheck + checkIntervalMin + graceMinutes`; job no-show at `scheduledFor + 15 min`.
- **Best-effort side effects never fail the cron** — each notify call is individually `.catch`-logged so one bad row doesn't abort the sweep; the route still returns `200` with counts.
- **Batch caps:** queue drainers take 50/run; `shift-checks` late-job and partner-chase queries `take: 100`. Large backlogs clear over successive runs, oldest first.
- **`CRON_SECRET` is the only credential** — these routes have no user session and no role check; the secret is the entire boundary. Do not add logic that trusts a caller identity.

## Entry points

- **Registration:** `vercel.json` `crons[]` (path + UTC schedule). Adding a route here + a `route.ts` is all Vercel needs.
- **Handlers:** `src/app/api/cron/<name>/route.ts`, each a `GET` beginning with `isAuthorisedCron(req)`.
- **Shared logic invoked elsewhere:** `materializePatrolVisits` / `materializeLockUnlockJobs` (also the dispatcher "Sync schedules" button); `drainQueue` (the two queue crons); all `notify*` helpers ([`10-notifications.md`](./10-notifications.md)).
- **Manual/dev invocation:** `curl` the path locally when `CRON_SECRET` is unset (dev only), or in prod `curl -H "Authorization: Bearer $CRON_SECRET" …`; use `?date=` / `?force=` for back-fills.

## Extension points & gotchas

- **Vercel plan limits.** The two `* * * * *` crons need a plan that permits per-minute cron frequency; on a plan capped at daily/hourly crons they silently won't run at that cadence and the notification queues won't drain. Confirm the Vercel plan before relying on minute-level delivery — see [`15-deployment-and-ops.md`](./15-deployment-and-ops.md).
- **Everything is UTC.** A schedule written as "9am" fires at 09:00 UTC = 10:00 UK during BST. If a cron must fire at a fixed UK wall-clock time year-round, it needs either two schedules or in-handler UK-time gating — the cron expression alone can't do DST.
- **Adding a cron:** register in `vercel.json`, create `src/app/api/cron/<name>/route.ts`, start with the `isAuthorisedCron` guard, and make the work idempotent (assume it runs late and possibly twice). Return a JSON summary of counts — the existing routes all do, which makes the Vercel cron logs useful.
- **Don't move side effects before their guard.** The no-show ordering and the `lastPartnerChaseAt` stamp-always pattern are deliberate; reordering them reintroduces double-alerts or missed alerts.
- **`blob-cleanup` is destructive and unrecoverable** — it hard-deletes blobs and does not scrub the URLs off submissions. Changing `RETENTION_DAYS` or the `uploads/` prefix has immediate data-loss consequences.
- **Schedule materialisation depends on `active` flags and UK weekday matching** — a schedule with `active = false`, an inactive site, or a `days` array missing the weekday produces nothing; "the visit didn't appear" is usually one of those, not a cron failure.
- **Cron delivery is at-least-once and approximate.** Never assume exactly-once or exact timing; the windows (30–60 min reminders, 14-min chase floor) are sized to absorb jitter — keep that slack if you retune them.
