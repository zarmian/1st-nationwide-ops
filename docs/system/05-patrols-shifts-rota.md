# Patrols, Shifts & Rota

> How recurring patrols/VPI, lock-up/unlock jobs, static-guarding/dog-handler shifts, and the region availability rota are scheduled, materialised by crons, executed on the ground, and attributed to a date for reporting and pay.

## Purpose & scope

Three loosely-related scheduling subsystems, documented together because they share the "recurring template → concrete dated activity → officer executes → finance snapshot" shape:

| Subsystem | Template model | Concrete activity | Officer surface |
| --- | --- | --- | --- |
| Patrols / VPI | `PatrolSchedule` | `PatrolVisit` | `/submit` + `/api/visits/[id]/on-site` |
| Lock-up / unlock | `LockUnlockSchedule` | `Job` (type `LOCK`/`UNLOCK`) | `/submit` (see `06-dispatch-jobs-alarms.md`) |
| Static guarding / dog handler | *(none — created directly)* | `Shift` | `/duty/[token]` public link |
| Rota & availability | `OfficerAvailability` (officer) + `RotaAssignment` (dispatch) | *(planning layer only — no concrete activity)* | `/m/rota` |

Key architectural fact: **patrol visits and lock/unlock jobs are materialised nightly by Vercel crons from their schedules**, deduplicated so re-runs never double up. Shifts are created directly (no recurrence engine). The rota is a **planning layer decoupled from `Shift`/`PatrolVisit`** — it records who is on-call per region per half-day and never auto-creates a concrete activity.

Out of scope here (cross-referenced): dispatch board & Job lifecycle (`06-dispatch-jobs-alarms.md`), rate resolution & pay snapshots (`09-finance-billing-pay.md`), WhatsApp/SMS/Telegram queueing (`10-notifications.md`), cron authentication & mechanics (`13-crons.md`).

## Data model

Source: `prisma/schema.prisma`. All ids are `uuid` (`gen_random_uuid()`) unless noted.

### Patrol scheduling

**`PatrolSchedule`** (recurring patrol/VPI template, one per site+cadence)

| Field | Type | Notes |
| --- | --- | --- |
| `siteId` | uuid → `Site` (cascade) | |
| `kind` | `ScheduleKind` = `PATROL` | `PATROL` or `VPI` |
| `dayOfWeek` | `DayOfWeek` (required) | matched via `getUTCDay` |
| `frequency` | `PatrolFrequency` = `WEEKLY` | ignored when `intervalWeeks` set |
| `timeOfDay` | `String?` | legacy single `"HH:MM"` UK wall-clock; kept in sync with `timesOfDay[0]` |
| `timesOfDay` | `String[]` = `[]` | multiple `"HH:MM"`; **one `PatrolVisit` per time**; a time earlier than the previous crosses midnight |
| `intervalWeeks` | `Int?` | custom "every N weeks from anchor"; overrides `frequency` |
| `exceptionDates` | `String[]` = `[]` | `"YYYY-MM-DD"` UK skip list |
| `assignedOfficerId` | uuid → `User?` | mutually exclusive with partner in UI |
| `handledByPartnerId` | uuid → `Partner?` (`PatrolSchedulePartner`) | subcontracted patrol |
| `partnerFillsOwnApp` | `Boolean` = false | copied to each visit; true → stub only, no `/submit` |
| `active`, `startsOn?`, `endsOn?`, `createdAt` | | `startsOn`/`endsOn` bound the window; `startsOn ?? createdAt` is the fortnightly/interval anchor |

**`PatrolVisit`** (materialised concrete visit)

| Field | Type | Notes |
| --- | --- | --- |
| `siteId` | uuid → `Site` | |
| `patrolScheduleId` | uuid → `PatrolSchedule?` | optional; **defaults to SetNull** on schedule delete (no explicit action) |
| `officerId` | uuid → `User?` | null when partner-handled |
| `handledByPartnerId` | uuid → `Partner?` (`PatrolVisitPartner`) | |
| `reportedViaPartnerApp` | `Boolean` = false | true → no `/submit`, no `ClientReport` |
| `scheduledAt` | `DateTime` | actual visit time (may be post-midnight) |
| `scheduleDate` | `DateTime?` | **UK midnight of the night/day this groups under — the accounting anchor** |
| `arrivedAt?`, `departedAt?` | | on-site window |
| `lat/lng/locatedAt?` | | location at submission |
| `gpsLat/gpsLng?` | | location at on-site tap |
| `status` | `VisitStatus` = `PENDING` | |
| `photoUrls` | `String[]` | Vercel Blob URLs |
| `cancelledAt?`, `cancelledByUserId?`, `statusBeforeCancel?` | | cancel audit / restore |
| `billedAmount/Currency/At?`, `paidAmount/Currency/At?`, `payRateUnit?` | | finance snapshot (see `09-...`) |
| relations | `job Job?` (via `Job.patrolVisitId`, unique), `formSubmissions FormSubmission[]` | |

**`LockUnlockSchedule`** (recurring lock-up/unlock template)

| Field | Type | Notes |
| --- | --- | --- |
| `siteId` | uuid → `Site` (cascade) | |
| `unlockTime` | `String?` | `"HH:MM"`; present → materialise an `UNLOCK` job |
| `lockdownTime` | `String?` | `"HH:MM"`; present → materialise a `LOCK` job |
| `days` | `DayOfWeek[]` = `[]` | days the site is locked/unlocked |
| `assignedOfficerId` | uuid → `User?` | |
| `active` | `Boolean` = true | |

> **This template materialises into `Job` rows, not `PatrolVisit` rows, and there is no FK from those jobs back to the schedule** — the schedule detail page matches them by `siteId` + `type IN (LOCK, UNLOCK)`.

**Enums:** `PatrolFrequency {WEEKLY, FORTNIGHTLY, MONTHLY}` · `ScheduleKind {PATROL, VPI}` · `DayOfWeek {MON…SUN}` · `VisitStatus {PENDING, IN_PROGRESS, COMPLETED, LATE, MISSED, CANCELLED}`.

### Shifts (static guarding / dog handler)

**`Shift`**

| Field | Type | Notes |
| --- | --- | --- |
| `siteId` | uuid → `Site` | |
| `officerId` | uuid → `User?` (`ShiftOfficer`) | null when partner-handled |
| `handledByPartnerId` | uuid → `Partner?` (`ShiftHandlerPartner`) | subcontracted |
| `handledByPartnerOfficerId` | uuid → `PartnerOfficer?` | filled by partner on their portal |
| `partnerChargeToUsAmount?`, `partnerOfficerPayAmount?`, `recordedByPartner` | | partner finance snapshot |
| `type` | `ShiftType` | `STATIC_GUARDING` / `DOG_HANDLER` |
| `scheduledStartsAt`, `scheduledEndsAt` | `DateTime` | **rota date = `scheduledStartsAt`** |
| `actualStartedAt?`, `actualEndedAt?` | | clocked from `/duty` |
| `status` | `ShiftStatus` = `PENDING` | |
| `checkIntervalMin` | `Int` = 60 | 0 disables the check-in cron (used by recorded-completed shifts) |
| `graceMinutes` | `Int` = 15 | buffer for start-miss and check-in window |
| `publicToken` | `String? @unique` | unguessable duty-link secret, generated on create |
| `officerNameRaw?` | | name typed on the duty page when not pre-assigned |
| `linkPhone?` | | E.164 mobile the duty link SMS goes to |
| `startLat/Lng/GpsAccuracy/DistanceM/WithinGeofence?` | | GPS + geofence result at start |
| `endLat/Lng/GpsAccuracy/DistanceM/WithinGeofence?` | | GPS + geofence result at end |
| `endedLate` / `lateReason?` | | end after scheduled end requires a reason |
| `payableMinutes?` | `Int` | worked minutes **rounded up to next 30-min block** — the pay basis |
| `billedAmount/…`, `paidAmount/…`, `payRateUnit?` | | finance snapshot; `paidAmount` null for partner-handled |
| relations | `formSubmissions FormSubmission[]` (`SHIFT_CHECK`), `jobs Job[]` (`Job.shiftId`, SetNull) | |

Each check-in is a `FormSubmission` with `form = SHIFT_CHECK` and `payload = { kind:"hourly_check", slotIndex, dueAt, gps:{lat,lng,accuracy}, distanceM, withinGeofence, photoUrl }`.

**Enums:** `ShiftType {STATIC_GUARDING, DOG_HANDLER}` · `ShiftStatus {PENDING, IN_PROGRESS, COMPLETED, MISSED, ABANDONED}`.

### Rota & availability

**`OfficerAvailability`** — officer-set. One row per `(officerId, date, shift)`; **existence = available, absence = not**. `date` is `@db.Date`; `shift` is `RotaShift`. Unique `[officerId, date, shift]`, index `[date, shift]`. `onDelete: Cascade` on officer.

**`RotaAssignment`** — dispatcher-set. Officer X on for region R, date D, half-day S. Fields: `date @db.Date`, `shift RotaShift`, `regionId → Region`, `officerId → User` (cascade), `notes?`, `createdByUserId?`. Unique `[date, shift, regionId, officerId]` (multiple officers per region+shift allowed), indexes `[officerId, date]` and `[regionId, date, shift]`.

**Enum `RotaShift {DAY, NIGHT}`** — `DAY` = 06:00–18:00 UK, `NIGHT` = 18:00–06:00 UK (next calendar day). The `date` anchor is the calendar date the half-day **starts** on. `@db.Date` columns hold pure UK calendar dates; actions parse `"YYYY-MM-DD"` to midnight UTC so no timezone maths is needed.

## Key files

- `prisma/schema.prisma` — all models/enums above.
- `src/lib/patrolDates.ts` — pure schedule evaluation: `evaluateSchedule` (with skip reason), `shouldCreateVisitOn`, `matchesEveryNWeeks`, `resolvePatrolSlots`, `normalisePatrolTimes`, `defaultScheduledAt`.
- `src/lib/scheduleSync.ts` — shared materialisation library: `materializePatrolVisits`, `materializeLockUnlockJobs`, `maybeCreateLockUnlock`. Called by both crons and the dispatch "Sync schedules" button. Idempotent.
- `src/lib/activityWhen.ts` — canonical scheduled-date attribution: `visitWhen`/`shiftWhen`/`jobWhen` (display) and `visitScheduledRange`/`shiftScheduledRange`/`jobScheduledRange` (Prisma where-fragments for month windows).
- `src/lib/shiftChecks.ts` — pure check-in slot maths: `computeCheckSlots`, `openSlotAt`, `nextSlotAfter`, `missedSlots`; `CHECKIN_LEAD_MIN = 10`. Shared client + server.
- `src/lib/geo.ts` — `evaluateGeofence`, `haversineMeters`, `roundMeters`, `DEFAULT_GEOFENCE_M = 300`.
- `src/lib/dutyLink.ts` — `dutyUrl(token)` builds the absolute `/duty/<token>` URL from `NEXTAUTH_URL`.
- `src/lib/tokens.ts` — `newPublicToken()` for the shift duty secret.
- `src/lib/reports/shiftReport.ts` — `loadShiftReportData` assembles the customer-facing (internal-free) shift report; `src/lib/reports/ShiftReportPdf.tsx` renders it.
- `src/lib/billing.ts` — `jobTypeToRateService`, `durationMinutes`, `roundUpToHalfHour`, `billForSite`, `payForOfficer`, `applyBillingTo*`/`applyPayTo*` (see `09-...`).

Pages / actions:
- `src/app/(app)/patrols/page.tsx` — schedules + lock/unlock + upcoming visits/jobs board with inline reassign & pause.
- `src/app/(app)/patrols/_actions.ts` — `reassignSchedule`, `toggleScheduleActive`, `reassignVisit`, `reassignLockUnlockSchedule`, `reassignJob`, `updatePatrolVisit`, `closePatrolVisit`, `cancelPatrolVisit`, `restorePatrolVisit`.
- `src/app/(app)/patrols/schedules/[id]/page.tsx`, `.../lockup-schedules/[id]/page.tsx`, `.../visits/[id]/page.tsx`, `.../visits/[id]/edit/page.tsx` — detail/edit (editing is deferred to `/sites/[id]/edit#…` anchors for schedules).
- `src/app/(app)/patrols/_components/QuickReassign.tsx` — inline officer `<select>` for schedule/visit/lock-unlock/job + `ToggleActive`.
- `src/app/(app)/patrols/_components/EditVisitForm.tsx` — admin visit editor; single `<select>` with `o:`/`p:` prefixes enforces officer-XOR-partner, exposes `partnerFillsOwnApp`.
- `src/app/(app)/shifts/page.tsx`, `.../new/page.tsx`, `.../[id]/page.tsx`, `.../[id]/edit/page.tsx`, `.../completed/new/page.tsx` — shift list, create, detail (report/link/check-ins/history), edit, record-after-the-fact.
- `src/app/(app)/shifts/_actions.ts` — `createShift`, `updateShift`, `deleteShift`, `sendShiftLinkSms`, `startShift`, `endShift`, `recordCompletedShift`.
- `src/app/(app)/shifts/_components/*` — `NewShiftForm`, `CompletedShiftForm`, `ShiftLinkCard` (copy + send SMS), `DeleteShiftButton`.
- `src/app/duty/[token]/page.tsx` + `DutyRunner.tsx` + `CameraCapture.tsx` + `_actions.ts` — the public, token-gated officer runner (`startDuty`, `checkInDuty`, `endDuty`).
- `src/app/(app)/rota/page.tsx` + `_components/RotaCell.tsx` + `_actions.ts` — dispatcher rota board (`assignToRota`, `unassignFromRota`, `setMyAvailability`).
- `src/app/(app)/m/rota/page.tsx` + `_components/AvailabilityToggle.tsx` — officer availability + read-only own assignments.
- `src/app/api/cron/patrol-visits/route.ts`, `.../lockunlock-jobs/route.ts`, `.../visit-statuses/route.ts`, `.../shift-checks/route.ts` — the four crons.
- `src/app/api/visits/[id]/on-site/route.ts`, `src/app/api/shifts/[id]/report/route.ts`, `src/app/api/submissions/route.ts` — on-site tap, PDF, and the shared submission handler.
- `vercel.json` — cron schedules.

## Core flows

### 1. Materialise patrol/VPI visits (nightly)

1. Vercel cron `5 0 * * *` → `GET /api/cron/patrol-visits` (`route.ts`); `isAuthorisedCron(req)` (`src/lib/cronAuth.ts`). Default offsets `[0,1]` (today+tomorrow); `?date=YYYY-MM-DD` back-fills a single day (`[0]`).
2. → `materializePatrolVisits({anchor, offsets})` (`scheduleSync.ts`). Loads **all `active` `PatrolSchedule`** rows once.
3. Per offset, `target` = anchor's UTC-midnight + offset days. Per schedule → `evaluateSchedule(schedule, target)` (`patrolDates.ts`): checks day-of-week (`getUTCDay`), `startsOn`/`endsOn` window, `exceptionDates` skip, then `intervalWeeks` (if set) else `frequency` (WEEKLY always · FORTNIGHTLY 2-week parity from anchor · MONTHLY only `getUTCDate() <= 7`).
4. If due → `resolvePatrolSlots(target, kind, timesOfDay, timeOfDay)` returns `{scheduledAt, scheduleDate}[]`. Times run in list order; a time earlier than the previous rolls `dayOffset += 1` (post-midnight), so `scheduledAt` lands on the next calendar day while **every slot's `scheduleDate` stays the matched night**. `normalisePatrolTimes` falls back `timesOfDay → timeOfDay → kind default` (VPI 09:00 / patrol 22:00), all interpreted as UK wall-clock via `ukWallClockToUtc`.
5. Per slot, dedupe via `findFirst({patrolScheduleId, scheduledAt})`; if absent, `create` a `PatrolVisit` — `officerId = handledByPartnerId ? null : assignedOfficerId`, `handledByPartnerId`, `reportedViaPartnerApp = handledByPartnerId ? partnerFillsOwnApp : false`, `status PENDING`.
6. Returns per-day `diagnostics` (created/exists/skipped + reason) surfaced by the manual sync UI.

### 2. Materialise lock-up/unlock jobs (nightly)

1. Vercel cron `10 0 * * *` → `GET /api/cron/lockunlock-jobs` → `materializeLockUnlockJobs({anchor, offsets:[0,1]})`.
2. Per UK day (`ukDayPlus`), compute `dow`; find `active` `LockUnlockSchedule` where `days has dow`, include `site {customerId, partnerId, active}`. Skip inactive sites.
3. If `unlockTime` → `maybeCreateLockUnlock(UNLOCK, …)`; if `lockdownTime` → `maybeCreateLockUnlock(LOCK, …)`.
4. `maybeCreateLockUnlock`: dedupe on `Job {siteId, type, source SCHEDULED, scheduledFor within the UK day}`; else `create` `Job` — `source SCHEDULED`, `status = officer ? ASSIGNED : OPEN`, `customerId`/`partnerId` copied from the site, `responderType INTERNAL_OFFICER`, `assignedToUserId`, `scheduledFor = parseHHMMToUk`.
5. Snapshot billing (`billForSite`, service `LOCKUP`/`UNLOCK`) and — when assigned — officer pay (`payForOfficer`) with accounting date = `scheduledFor`.

### 3. Officer executes a patrol visit

1. On arrival: officer taps On-site → `POST /api/visits/[id]/on-site` (`route.ts`). Session required; **owner or ADMIN/DISPATCHER only**. Sets `status IN_PROGRESS`, `arrivedAt` (if unset), `gpsLat/Lng`; self-assigns `officerId` if the visit was unassigned. Fires `notifyVisitStarted` best-effort.
2. On completion: the `/submit` form `POST`s to `/api/submissions/route.ts` with `patrolVisitId`. It creates a `FormSubmission` (`form PATROL`/`VPI`) + a `ReportReview` (auto-`APPROVED` for PATROL/VPI/LOCK/UNLOCK — routine activities skip the review queue), then updates the visit → `status COMPLETED`, `departedAt` (form value or now), `arrivedAt` (preserves the real on-site tap). Fires `notifyVisitCompleted`.
3. Finance snapshot on the visit: `rateService = jobTypeToRateService(form)`, `duration = durationMinutes(arrived, departed)`, `billForSite` + (when attender known) `payForOfficer`, **accounting date = `scheduleDate ?? scheduledAt`** (overnight patrols bill in the month they were scheduled for).

Dispatcher fallbacks (`patrols/_actions.ts`): `closePatrolVisit` marks COMPLETED on the officer's behalf (stamps arrived/departed, snapshots finance); `cancelPatrolVisit` sets CANCELLED, reverses billing+pay, records `statusBeforeCancel`; `restorePatrolVisit` (admin) returns to `statusBeforeCancel`, re-snapshotting only if it comes back COMPLETED; `updatePatrolVisit` is the admin override editor.

### 4. Visit status sweep (hourly)

1. Cron `0 * * * *` → `GET /api/cron/visit-statuses`.
2. Selects the **to-flip sets first** (so each can be notified): PENDING with `scheduledAt ≤ now−1h` and `> now−24h` → LATE; `{PENDING,LATE,IN_PROGRESS}` with `scheduledAt ≤ now−24h` → MISSED.
3. Applies both `updateMany`s in one `$transaction`, then queues `notifyVisitLateOrMissed(id, "LATE"|"MISSED")` per row (best-effort; see `10-notifications.md`).

### 5. Create & dispatch a shift with a duty link

1. `/shifts/new` → `NewShiftForm` → `createShift` (`shifts/_actions.ts`, `requireStaff`). `NewShiftInput`: site, type, start/end (`parseUkDateTimeLocal`, end>start), `checkIntervalMin` 5–720 (default 60), `graceMinutes` 0–120 (default 15).
2. Handler is `own` or `partner`. Partner must be `SUBCONTRACTOR`/`BOTH` and **requires** an E.164 `linkPhone`; an own officer with no `linkPhone` defaults to `User.phone`.
3. `create` `Shift` with `publicToken = newPublicToken()`, `linkPhone`, `officerNameRaw`; `logActivity("created")`; redirect to `/shifts/[id]`.
4. On the detail page, `ShiftLinkCard` → `sendShiftLinkSms`: sends `dutyUrl(token)` immediately via `sendSms`, writes a `Notification (SHIFT_LINK)` row + `logActivity("link_sent")`.

### 6. Officer runs the shift via `/duty/[token]` (no login)

1. `/duty/[token]/page.tsx` loads the `Shift` by `publicToken` → `DutyRunner` (client). Client shows a live distance readout and the check-in countdown (advisory only).
2. **Start** → `startDuty` (`_actions.ts`): reload by token; must not be closed/already running; require identity (pre-assigned, on-file `officerNameRaw`, or a typed name); `evaluateGeofence` (site coords + `geofenceRadiusM ?? 300`) — blocks if `enforced && !withinRadius`. Sets `IN_PROGRESS`, `actualStartedAt`, start GPS fields; if a logged-in officer opened their own unassigned, non-partner shift, claims `officerId`. `logActivity("started_on_duty")`.
3. **Check-in** → `checkInDuty`: requires IN_PROGRESS + a photo. `computeCheckSlots({startBasis: actualStartedAt ?? scheduledStartsAt, endBasis: scheduledEndsAt, intervalMin, graceMin})` — first slot one interval in, last strictly before end; window `opensAt = dueAt−10min`, `closesAt = dueAt+grace`. `openSlotAt(now)` must return a slot; one check-in per `slotIndex` (dedupe on `payload.slotIndex`); geofence; creates the `SHIFT_CHECK` `FormSubmission`. This is the authoritative time-window enforcement — the client only mirrors it.
4. **End** → `endDuty`: geofence; `isLate = now > scheduledEndsAt` requires a `lateReason`; `worked = durationMinutes(start, end)`, `payable = roundUpToHalfHour(worked)`. Sets COMPLETED, `actualEndedAt`, end GPS, `endedLate`/`lateReason`, `payableMinutes`. Finance: **bill on `worked`, pay officer on `payable`**, accounting date `scheduledStartsAt`; officer pay only for own officers. `logActivity("ended_on_duty")`.

`/api/submissions` also stamps the shift's `lat/lng/locatedAt` from a `SHIFT_CHECK` submission when a location is supplied (last write wins).

### 7. Shift no-show + check-in overdue sweep (every 15 min)

Cron `*/15 * * * *` → `GET /api/cron/shift-checks` does four things (summary; mechanics in `13-crons.md`):
1. **PENDING → MISSED**: shifts past `scheduledStartsAt + graceMinutes` → `notifyOfficerNoShow` + `alertNoShowTelegram` **queued before** the status flip (a queue failure leaves it PENDING for the next run to retry), then flip to MISSED so it drops out next run (alert fires exactly once).
2. **Late jobs → dispatcher SMS**: `{APPROVED,SUBMITTED}` jobs, assigned, `startedAt null`, `scheduledFor < now−15min` → `notifyOfficerNoShow(Job)`; Telegram only when the SMS was freshly queued.
3. **Overdue check-ins**: for IN_PROGRESS shifts, `last = latest SHIFT_CHECK submittedAt ?? actualStartedAt`; if `now > last + (checkIntervalMin + graceMinutes)` → `notifyShiftCheckOverdue`, de-duped against any `SHIFT_CHECK_OVERDUE` notification newer than `last` (writes a `SKIPPED` marker when there are no WhatsApp recipients, so Telegram-only setups don't re-broadcast every sweep).
4. **Partner hand-off chase**: open jobs with `handledByPartnerId`, no `partnerReportRef`, due → `alertPartnerUpdateDueTelegram`, stamping `lastPartnerChaseAt` on a 14-min floor.

### 8. Record an already-completed shift

`/shifts/completed/new` → `recordCompletedShift`: creates a `Shift` at `status COMPLETED` with `actualStartedAt/EndedAt` = the entered times and `scheduledStartsAt/EndsAt` mirroring them (so `/shifts` scheduled-time queries still surface it), `checkIntervalMin = 0` + `graceMinutes = 0` (**disables the check-in cron**), handler own or partner. Snapshots billing + (own-officer only) pay at accounting date = start.

### 9. Rota planning

- Officer, `/m/rota`: `AvailabilityToggle` → `setMyAvailability` (`rota/_actions.ts`, `requireUser`) upserts (available) or deletes (unavailable) one `OfficerAvailability` row. Also renders read-only "you're on the rota for" assignments.
- Dispatcher, `/rota`: week grid (regions × day×shift). `RotaCell` picker lists officers who marked themselves available for that `(date, shift)` and aren't yet placed in any region; `assignToRota` creates a `RotaAssignment` (P2002 unique-violation treated as idempotent), `unassignFromRota` deletes one. Both `requireStaff`.

### 10. Manual "Sync schedules" (dispatch)

`/dispatch` `SyncSchedulesButton` → `syncSchedulesNow` (`dispatch/_actions.ts`, `requireStaff`) runs `materializeLockUnlockJobs` + `materializePatrolVisits` with `offsets:[0,1]` and returns counts + patrol diagnostics — same code path as the crons, for on-demand back-fill.

## Business rules & invariants

- **Scheduled-date attribution** (`activityWhen.ts`): activity lists and finance/pay month windows filter by the *scheduled* date, falling back to completion only for ad-hoc work. Visit → `scheduleDate` (else `scheduledAt`); Shift → `scheduledStartsAt`; Job → `scheduledFor` (else `completedAt`). A visit scheduled for the 30th but finished on the 1st still counts on the 30th. Overnight patrols group under the night they started via `scheduleDate`.
- **UK wall-clock everywhere**: all `"HH:MM"` strings are UK local, converted with `ukWallClockToUtc` (BST/GMT-aware). Kind defaults: VPI `09:00`, patrol `22:00`.
- **Materialisation is idempotent**: patrol dedupe on `(patrolScheduleId, scheduledAt)`; lock/unlock dedupe on `(siteId, type, source SCHEDULED, scheduledFor ∈ UK day)`. A cancelled visit is never re-created because the dedupe key (`scheduledAt`) still matches.
- **Officer XOR partner** on schedule, visit, and shift. Partner-handled rows carry no `officerId`; `reportedViaPartnerApp`/`partnerFillsOwnApp` govern whether our `/submit` + `ClientReport` flow runs at all.
- **Two different targets**: `PatrolSchedule` → `PatrolVisit`; `LockUnlockSchedule` → `Job` (`LOCK`/`UNLOCK`).
- **Frequency semantics**: WEEKLY = every match; FORTNIGHTLY = 2-week parity measured from `startsOn ?? createdAt ?? epoch`; MONTHLY = the matching weekday only in week 1 (`date ≤ 7`), i.e. *not* "same date each month"; `intervalWeeks ≥ 1` overrides the enum.
- **Geofence** (`geo.ts`): radius = `Site.geofenceRadiusM ?? 300 m`. When the site has no coordinates it is **not enforced** (`enforced:false, withinRadius:true`) so an officer is never permanently blocked; the record is flagged for admins. Server actions re-check authoritatively.
- **Check-in window**: opens 10 min before due (`CHECKIN_LEAD_MIN`), closes `dueAt + graceMinutes`; first slot one interval after start, last strictly before scheduled end; one check-in per slot.
- **Shift pay basis**: `worked = actualEnd − actualStart`; `payableMinutes = roundUpToHalfHour(worked)` (any part-block = a full 30 min). Bill on `worked`, pay on `payable`. Partner-handled shifts leave `paidAmount` null — the cost is the partner's `partnerChargeToUsAmount`.
- **Auto-approve**: PATROL/VPI/LOCK/UNLOCK submissions skip the review queue (land APPROVED, snapshot finance immediately); ALARM_RESPONSE/ADHOC require admin review.
- **Rota is planning-only**: `OfficerAvailability`/`RotaAssignment` are `@db.Date` rows decoupled from any concrete `Shift`/`PatrolVisit`; nothing is auto-created from an assignment. Multiple officers may be assigned per region+shift.
- **Cron auth** (`cronAuth.ts`): requires `Authorization: Bearer $CRON_SECRET`; bypassed only when `CRON_SECRET` is unset **and** not production.

## Entry points

Crons (schedules in `vercel.json`; all `GET`, `isAuthorisedCron`):
- `/api/cron/patrol-visits` — `5 0 * * *` — materialise patrol/VPI visits (today+tomorrow).
- `/api/cron/lockunlock-jobs` — `10 0 * * *` — materialise lock/unlock jobs (today+tomorrow).
- `/api/cron/visit-statuses` — `0 * * * *` — flip visits LATE (+1h) / MISSED (+24h) + notify.
- `/api/cron/shift-checks` — `*/15 * * * *` — shift no-show, late-job SMS, overdue check-ins, partner chase.

Other API routes:
- `POST /api/visits/[id]/on-site` — officer/admin marks a visit IN_PROGRESS with GPS.
- `POST /api/submissions` — shared handler: completes patrol visits, records shift check-in locations, auto-approves routine forms (see `06-...`).
- `GET /api/shifts/[id]/report` — ADMIN/DISPATCHER-only customer-facing shift PDF (`loadShiftReportData` → `renderShiftReportPdf`).

Server actions:
- Patrols (`patrols/_actions.ts`): `reassignSchedule`, `toggleScheduleActive`, `reassignVisit`, `reassignLockUnlockSchedule`, `reassignJob`, `updatePatrolVisit`, `closePatrolVisit`, `cancelPatrolVisit`, `restorePatrolVisit`.
- Shifts (`shifts/_actions.ts`): `createShift`, `updateShift`, `deleteShift` (cancels live linked jobs first), `sendShiftLinkSms`, `startShift`/`endShift` (from `/m/today`), `recordCompletedShift`.
- Duty (`duty/[token]/_actions.ts`): `startDuty`, `checkInDuty`, `endDuty` — token-gated, no session.
- Rota (`rota/_actions.ts`): `setMyAvailability`, `assignToRota`, `unassignFromRota`.
- Dispatch (`dispatch/_actions.ts`): `syncSchedulesNow`.

## Extension points & gotchas

- **`LockUnlockSchedule` → `Job` has no FK.** Materialised jobs are matched back by `siteId` + `type`, so the schedule detail page can show unrelated ad-hoc lock/unlock jobs and can't cleanly "un-materialise". A rebuild should add a nullable `Job.lockUnlockScheduleId`.
- **`visit-statuses` marks MISSED purely on `scheduledAt + 24h`**, ignoring `reportedViaPartnerApp`/partner-handled visits — a partner-app visit the partner actually did in their own app will still flip to MISSED here. Exclude partner-app visits, or reconcile against the partner report reference.
- **Shifts have no recurrence engine.** They are created one-by-one (or recorded after the fact); there is no `ShiftSchedule` equivalent to `PatrolSchedule`. Recurring guarding therefore lives entirely in the manual create flow.
- **`Shift` ↔ `Job` link is latent.** `Job.shiftId` (SetNull) exists and `deleteShift` cancels live linked jobs, but `createShift` does **not** create a Job — the `STATIC_GUARDING_SHIFT`/`DOG_HANDLER_SHIFT` `JobType` values and the `dayActivities` aggregation synthesise shift rows into the activity feed separately. Don't assume a shift appears on the dispatch board.
- **Duty tokens never expire.** `publicToken` is unguessable but permanent; the "invalid or expired" copy is aspirational — there is no expiry/rotation mechanism. Anyone with the link can act on that one shift.
- **`payableMinutes` is only set by `endDuty`.** `recordCompletedShift`, admin edits, and cron paths leave it null even though `actualStartedAt/EndedAt` imply a value — the shift detail page recomputes "worked" on the fly but the stored `payableMinutes` can be stale/absent.
- **Report vs enforcement use different end bases.** `loadShiftReportData` computes expected check-ins from `actualEndedAt ?? scheduledEndsAt`, while live `checkInDuty` enforcement uses `scheduledEndsAt`. A shift ended early can show a different "expected" count than the officer was actually asked for.
- **Day-of-week uses `getUTCDay` but times use UK wall-clock** (`scheduleSync` comments call this out). Near the DST-shifted midnight edge the UTC day and UK day can differ; the code deliberately keeps the UTC-day convention for `evaluateSchedule` — verify before changing.
- **FORTNIGHTLY/`intervalWeeks` parity depends on the anchor** (`startsOn` else `createdAt`). Editing a schedule's `createdAt`/`startsOn`, or recreating it, silently shifts which weeks fire.
- **`timeOfDay` (legacy) vs `timesOfDay[]`.** Keep `timesOfDay[0]` in sync with `timeOfDay`; `normalisePatrolTimes` tolerates either but readers differ.
- **PatrolVisit → PatrolSchedule is optional with default SetNull.** Deleting a schedule orphans its visits (`patrolScheduleId` nulled); the UI then can't tell PATROL from VPI and defaults the label to "Patrol".
