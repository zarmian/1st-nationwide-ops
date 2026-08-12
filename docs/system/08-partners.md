# Partners

> The three simultaneous partner relationship modes, the partner/partner-officer portal, partner-recorded activities and rate cards, the 15-minute hand-off chase, and the Nexus site import.

## Purpose & scope

1NW works with other security firms in **three modes at once**. The whole schema and reporting layer bends around this — get the two partner links wrong and money/reports attribute to the wrong side. This doc covers:
- The three modes and the exact fields that distinguish them.
- `Partner`, `PartnerOfficer`, `PartnerRate`, `PartnerContact` and the partner-related fields on `Job`/`Shift`/`Site`/`PatrolSchedule`/`PatrolVisit`.
- The partner portal (`/partner/*`, role `PARTNER`) and partner-officer mobile surface (`/partner/m/*`, role `PARTNER_OFFICER`).
- Partner self-recorded jobs/shifts, officer assignment to 1NW-logged work, and the partner finance view.
- The Nexus CSV import that bulk-loads partner-customer sites + rates.
- **Cross-refs:** the `Job`/dispatch mechanics a hand-off rides on → [`06-dispatch-jobs-alarms.md`](./06-dispatch-jobs-alarms.md); how partner rate snapshots feed P&L/pay → [`09-finance-billing-pay.md`](./09-finance-billing-pay.md); the Telegram chase broadcast → [`10-notifications.md`](./10-notifications.md).

## The three modes (read first)

| # | Mode | Who attends | Whose app / report | Key fields | Produces |
|---|---|---|---|---|---|
| 1 | **Direct customer** (Shurgard, Aegis, Orbis) | 1NW officer | Our `/submit` → admin review | `Job.customerId` (+ `Site.customerId`) | `FormSubmission` + `ClientReport` |
| 2 | **Partner-as-customer** — we are *their* subcontractor (Nexus London activations, Keyholding Co on-demand) | **1NW officer** | **The partner's own app** | `Site.partnerId` / `Job.partnerId`; `Job.reportedViaPartnerApp=true`; optional `Job.partnerReportRef` | Internal **stub `Job`** only — **no `/submit`, no `ClientReport`** |
| 3 | **Partner-as-subcontractor** — we sub work *out* to them (Shurgard-outside-London → Nexus) | **Their** officer | Their app; they email the report back | `Job.handledByPartnerId` (+ `handledByPartnerOfficerId`, `handedOffAt`, `lastPartnerChaseAt`, `partnerReportRef`) | Stub `Job`; ingested into our daily report; 15-min chase |

The load-bearing distinction: **`Site.partnerId`/`Job.partnerId` (mode 2, partner *is the customer*) vs `Job.handledByPartnerId` (mode 3, partner *did the work for us*) mean opposite things.** A partner can be both (`PartnerRole.BOTH`) — Nexus and Keyholding Co are.

## Data model

Source: `prisma/schema.prisma`. Money is `Decimal(10,2)`.

### Enums
- `PartnerRole` — `CUSTOMER`, `SUBCONTRACTOR`, `BOTH`.
- `PartnerChannel` — `EMAIL`, `PHONE`, `THEIR_APP`, `WHATSAPP`, `PORTAL` (partner's preferred intake channel).

### Models
**`Partner`**
- `name @unique`, `role PartnerRole`, `preferred PartnerChannel @default(EMAIL)`, `emailIntake String?`, `notes?`, `active`.
- Relations: `contacts PartnerContact[]`; `jobs` (via `Job.partnerId`, mode 2); `handledJobs` (via `Job.handledByPartnerId`, mode 3); `handledShifts`; `handledPatrolSchedules`/`handledPatrolVisits`; `sites` (via `Site.partnerId`, mode 2); `formTemplates` (PARTNER-scope); `users` (login seats); `partnerOfficers`; `rates`.

**`PartnerOfficer`** — the partner's **private** roster (invisible to 1NW staff pages).
- `partnerId` (cascade), `name`, `phone?`, `siaNumber?`, `notes?`, `active`.
- `userId String? @unique` (SetNull) — optional 1:1 link to a `User(role=PARTNER_OFFICER)` giving that officer a phone login.
- Relations `handledJobs`/`handledShifts` (via `handledByPartnerOfficerId`).

**`PartnerRate`** — one row per `(partnerId, service)` (`@@unique`).
- `service RateService`, `chargeToUs Decimal`, `payToOfficer Decimal`, `currency`, `unit RateUnit @default(PER_VISIT)`, `notes?`. Auto-fills the record-activity form; overridable per activity.

**`PartnerContact`** — `partnerId` (cascade), `name`, `email?`, `phone?`, `role?`, `notes?`.

### Partner-related fields on other models
- **`User`**: `role` may be `PARTNER` or `PARTNER_OFFICER`; `partnerId String?` (SetNull) scopes the portal; `partnerOfficerSeat` back-relation (1:1) when a partner officer.
- **`Site.partnerId`** — mode-2 tagging (partner-customer's site). Also carries partner-supplied metadata: `partnerReference`, `partnerSin`, `sapRef`, `opsUnit`, `what3words`, `partnerStatus`, `startDate`, `terminationDate`, `dne`, `hsMarkers`.
- **`Job`**: `partnerId` (mode 2) **vs** `handledByPartnerId` (mode 3); `handledByPartnerOfficerId?`; `reportedViaPartnerApp Boolean @default(false)`; `partnerReportRef String?`; `recordedByPartner Boolean` (created from the portal); `partnerChargeToUsAmount?` / `partnerOfficerPayAmount?` (rate snapshot); `handedOffAt?`; `lastPartnerChaseAt?` (paces the chase cron).
- **`Shift`**: `handledByPartnerId?`, `handledByPartnerOfficerId?`, `partnerChargeToUsAmount?`, `partnerOfficerPayAmount?`, `recordedByPartner`.
- **`PatrolSchedule`/`PatrolVisit`**: `handledByPartnerId?`; schedule `partnerFillsOwnApp Boolean` → copied to visit as `reportedViaPartnerApp` (`false` = partner fills our form; `true` = their app, stub only).

## Key files

**Partner portal (role `PARTNER`)**
- `src/app/partner/layout.tsx` — shell; picks `PartnerTopNav` vs `PartnerOfficerTopNav` by role; re-checks session + `partnerId` + active partner.
- `src/app/partner/page.tsx` — home KPIs (activities this month = `handledByPartnerId` jobs completed; roster size).
- `src/app/partner/activities/page.tsx` — merged log: jobs we sent (`handledByPartnerId`, read-only), jobs/shifts the partner recorded (editable). Source chip = "1NW logged" vs "You logged".
- `src/app/partner/activities/_actions.ts` — `createPartnerActivity`, `updatePartnerActivity`, `cancelPartnerActivity`, `getPartnerRateForType`, `assignAdminShift`, `assignAdminJob`.
- `src/app/partner/activities/_components/PartnerActivityForm.tsx` — single job|shift form, rate auto-fill, shift completed|scheduled sub-mode.
- `src/app/partner/activities/[id]/assign/**` — assign an officer + rates to a 1NW-logged job/shift (`AssignOfficerForm`).
- `src/app/partner/officers/**` — roster CRUD + mobile-login provisioning (`_actions.ts`, `PartnerOfficerLoginCard.tsx`).
- `src/app/partner/rates/**` — rate-card upsert per service (`_actions.ts`, `RateCardForm.tsx`).
- `src/app/partner/finance/page.tsx` — partner's own P&L (billed to 1NW, paid to officers, margin; by officer/customer/service).

**Partner-officer mobile (role `PARTNER_OFFICER`)**
- `src/app/partner/m/today/page.tsx` — the officer's assigned jobs/shifts over ±1/+7 days.
- `src/app/partner/m/activities/[id]/page.tsx` + `_actions.ts` — edit arrival/departure times + notes, mark done (`updateAssignedActivity`, `markAssignedActivityDone`).

**Admin-side & shared**
- `src/app/(app)/admin/partners/**` — partner CRUD + contacts (`_actions.ts`, `PartnerForm.tsx`); `[id]/_actions.ts` = `upsertPartnerLogin`/`deactivatePartnerLogin`.
- `src/lib/authz.ts` — `requirePartner()` / `requirePartnerOfficer()`; both return a guaranteed non-null `partnerId` from the **session** to scope every query.
- `middleware.ts` — hard-locks `PARTNER` to `/partner/*` (not `/partner/m/*`) and `PARTNER_OFFICER` to `/partner/m/*`.
- `src/lib/nexusImport.ts` — Nexus CSV parse + upsert; `src/app/(app)/admin/imports/nexus/**` (`_actions.ts`, `ImportPanel`, `ResetPanel`).
- `src/lib/telegramNotify.ts` — `alertPartnerUpdateDueTelegram` (mode-3 chase broadcast).
- `src/app/api/cron/shift-checks/route.ts` — §3 partner hand-off sweep.

## Core flows

### A. Partner-portal login provisioning
1. **Partner seat** (`admin/partners/[id]/_actions.ts::upsertPartnerLogin`, `requireAdmin`): creates/updates a `User(role=PARTNER, partnerId=…)`; one shared seat per partner today; changing the email creates a new seat and deactivates the old one so stale sessions die. Password ≥8, bcrypt.
2. **Partner-officer seat** (`partner/officers/_actions.ts::upsertPartnerOfficerLogin`, `requirePartner`): creates/updates a `User(role=PARTNER_OFFICER)` and links it 1:1 via `PartnerOfficer.userId`. Empty password = keep current.
3. On sign-in, `partnerId` (and role) ride the NextAuth JWT; `requirePartner`/`requirePartnerOfficer` read it and **scope every Prisma `where` by the session `partnerId`, never the request body**. `requirePartnerOfficer` does one extra lookup to resolve `partnerOfficerId` from `PartnerOfficer.userId` (kept off the JWT to avoid staleness).

### B. Partner records their own activity (`recordedByPartner=true`)
1. `/partner/activities/new` renders `PartnerActivityForm`; picking a job/shift type auto-fills `chargeToUs`/`payToOfficer` from `PartnerRate` (client mirror of `JOB_TYPE_TO_RATE`/`SHIFT_TYPE_TO_RATE`), overridable.
2. Submit → `createPartnerActivity`: `requirePartner`, Zod-parses (discriminated union JOB | SHIFT-completed | SHIFT-scheduled), and **cross-checks the site belongs to the chosen customer and the officer belongs to this partner** (guards against a smuggled id).
3. Writes:
   - **Job**: `source=PARTNER_REQUEST`, `status=APPROVED` (already-done work), `responderType=PARTNER`, `handledByPartnerId=session`, `handledByPartnerOfficerId`, rate snapshot, `recordedByPartner=true`. `partnerId` is left **null** (this is mode-3 work-for-us, not mode-2 tagging).
   - **Shift completed**: `status=COMPLETED`, check-ins disabled (`checkIntervalMin/graceMinutes=0`).
   - **Shift scheduled**: `status=PENDING`, future start/end + check interval/grace — the assigned partner officer can clock in later on `/partner/m/*`.
4. `updatePartnerActivity`/`cancelPartnerActivity` scope by `handledByPartnerId + recordedByPartner=true` via `updateMany` (cross-tenant attempts no-op with `count=0`). Shifts are **deleted** on cancel (no `CANCELLED` shift status); jobs go `CANCELLED`.

### C. Partner assigns an officer to 1NW-logged work
1. On `/partner/activities`, rows we logged (`recordedByPartner=false`) show an "assign officer" link → `/partner/activities/[id]/assign` (`shift-<uuid>` prefix distinguishes shift from job).
2. `assignAdminJob`/`assignAdminShift` (`requirePartner`) scope strictly to `handledByPartnerId=session AND recordedByPartner=false`, set `handledByPartnerOfficerId` + `partnerChargeToUsAmount`/`partnerOfficerPayAmount`. This is how a dispatched mode-3 hand-off gets its officer + finance breakdown from the partner side.

### D. Partner-officer completes assigned work
1. `/partner/m/today` (`requirePartnerOfficer`) lists jobs/shifts where `handledByPartnerOfficerId = my seat`, open first.
2. Detail page → `updateAssignedActivity` lets the officer edit arrived/departed (→ job `startedAt`/`completedAt`) or start/end (shift `actualStartedAt`/`actualEndedAt`) + notes only — **not** site/customer/type/rates. `markAssignedActivityDone` stamps completion now, backfilling start if null. All scoped by `handledByPartnerOfficerId`.

### E. Mode-3 hand-off chase (dispatch never gets an automatic completion)
1. Dispatch creates/edits a job with the partner as handler (`dispatch/_actions.ts`, `dispatch/callouts/_actions.ts`, `handlerKind=partner`) → sets `handledByPartnerId` + `handedOffAt`; may set `reportedViaPartnerApp`.
2. `GET /api/cron/shift-checks` §3 (every ~15 min) finds jobs with `handledByPartnerId` set, still open (`OPEN…REVIEW_PENDING`), `completedAt=null`, `partnerReportRef=null`, past their scheduled time, and `lastPartnerChaseAt` null or older than a **14-min floor**.
3. For each, `alertPartnerUpdateDueTelegram` (`telegramNotify.ts`) broadcasts a "Chase <partner> for an update" message to every linked dispatcher/admin, then stamps `lastPartnerChaseAt=now` (stamped even if Telegram is unconfigured, so the cadence holds). Chasing stops once the job is closed/cancelled/completed **or `partnerReportRef` is filled in** (paste the partner's PDF ref when they email the report back).

### F. Nexus site import (mode-2 partner-customer sites)
1. `/admin/imports/nexus` uploads a CSV. `previewImport` → `previewNexusImport` (`nexusImport.ts`) classifies rows create/update by `partnerReference`, then `(postcode,name)` fallback, without writing.
2. `commitImport` → `runNexusImport` requires the `"Nexus Security"` partner to exist, then per row (own transaction) upserts the `Site` with `partnerId=Nexus` + `partnerReference`, deletes+rewrites its `SiteRate`s from the 9 rate columns (`RATE_COLUMNS`). Bad rows are skipped, not fatal.
3. `ResetPanel`/`resetData` is a guarded (`"RESET"` phrase, admin-only) cascading wipe used to re-seed; reference-data scopes force the site cascade first.

## Business rules & invariants

- **Every partner query scopes by the session `partnerId`** (`requirePartner`/`requirePartnerOfficer`), never by anything in the URL/body. Cross-tenant writes use `updateMany`/`deleteMany` so they silently no-op instead of leaking.
- **The `PartnerOfficer` roster is private** — it never appears in any 1NW `/officers` or dispatcher picker; only the partner portal (scoped to its `partnerId`) can read it.
- **`Job.partnerId` (mode 2) and `Job.handledByPartnerId` (mode 3) are mutually distinct.** Portal-recorded jobs set `handledByPartnerId` and leave `partnerId` null. Don't conflate them.
- **`reportedViaPartnerApp=true` ⇒ no `/submit`, no `ClientReport`** (enforced in the approve action and review page). A partner-app job is a pay/audit stub only.
- **Partner-recorded rows land terminal** (`Job=APPROVED`, completed `Shift=COMPLETED`) — the user is logging work already done; there is no pending/dispatch flow. Scheduled shifts are the one exception (`PENDING`).
- **Edit/cancel gating**: partner may edit only `recordedByPartner=true` rows; "assign officer" applies only to `recordedByPartner=false` rows. A partner officer may edit only rows where `handledByPartnerOfficerId` = their seat, and only times/notes.
- **Partner finance perspective** (`/partner/finance`) counts partner-recorded rows **plus** 1NW-logged rows the partner has priced (`chargeToUs>0` or `payToOfficer>0`); un-priced 1NW-logged work is excluded until "assign officer" sets a rate. Amounts are the partner's own snapshots, independent of our `SiteRate`/`OfficerRate` billing (see [`09-finance-billing-pay.md`](./09-finance-billing-pay.md)).
- **Middleware hard-locks**: `PARTNER` → `/partner/*` except `/partner/m/*`; `PARTNER_OFFICER` → `/partner/m/*` only; staff (no `partnerId`) are bounced out of `/partner/*`.
- Partner-handled shifts leave `paidAmount` null — their cost is captured by `partnerChargeToUsAmount` instead.

## Entry points

**Server actions — partner portal (`requirePartner`)**
- `partner/activities/_actions.ts`: `createPartnerActivity`, `updatePartnerActivity`, `cancelPartnerActivity`, `assignAdminJob`, `assignAdminShift`, `getPartnerRateForType`.
- `partner/officers/_actions.ts`: `createPartnerOfficer`, `updatePartnerOfficer`, `setPartnerOfficerActive`, `upsertPartnerOfficerLogin`, `deactivatePartnerOfficerLogin`.
- `partner/rates/_actions.ts`: `upsertPartnerRate`, `deletePartnerRate`.

**Server actions — partner-officer mobile (`requirePartnerOfficer`)**
- `partner/m/activities/_actions.ts`: `updateAssignedActivity`, `markAssignedActivityDone`.

**Server actions — admin (`requireAdmin`)**
- `admin/partners/_actions.ts`: `createPartner`, `updatePartner` (+ contact sync).
- `admin/partners/[id]/_actions.ts`: `upsertPartnerLogin`, `deactivatePartnerLogin`.
- `admin/imports/nexus/_actions.ts`: `previewImport`, `commitImport`, `getResetCounts`, `resetData`.

**Crons**
- `GET /api/cron/shift-checks` — §3 sweeps mode-3 hand-offs and broadcasts the 15-min chase (secret-gated via `isAuthorisedCron`).

**Pages (SSR):** `/partner`, `/partner/activities(/new|/[id]/edit|/[id]/assign)`, `/partner/officers(/new|/[id]/edit)`, `/partner/rates`, `/partner/finance`, `/partner/m/today`, `/partner/m/activities/[id]`, `/admin/partners(/new|/[id]/edit)`, `/admin/imports/nexus`.

## Extension points & gotchas

- **One shared `PARTNER` login per partner today.** The `Partner.users` relation is many-to-one so more seats can be added later without a schema change, but `upsertPartnerLogin` assumes a single seat (`findFirst … role=PARTNER`).
- **Mode 2 has almost no portal automation.** "Partner-as-customer" is realised mainly by `Site.partnerId` tagging, PARTNER-scoped form templates, and a stub `Job` with `reportedViaPartnerApp=true`. The rich portal (activities/finance/rates) is built around `handledByPartnerId` (mode 3 + self-recording). Don't expect mode-2 jobs to surface in `/partner/*`.
- **`handledByPartnerId` vs `partnerId` is the single easiest bug.** Reports, finance, and the chase cron all key off `handledByPartnerId`; only site tagging and the mode-2 stub use `partnerId`.
- **Encoded ids**: the portal prefixes shift ids with `shift-` to multiplex jobs and shifts through one `[id]` route. Any new activity source must extend the `startsWith("shift-")` parsing in the activities/assign/mobile handlers.
- **Shifts have no `CANCELLED` state** — `cancelPartnerActivity` **deletes** the shift row (jobs are set `CANCELLED`). A rebuild should add a shift cancel status to keep history.
- **`markAssignedActivityDone` fights `updateMany`'s lack of conditional set** — it uses a second `updateMany` to backfill start when null; watch this if you refactor.
- **Chase cadence**: `lastPartnerChaseAt` is stamped even when Telegram is unconfigured, so the 14-min floor holds and nobody is re-hammered — but it also means "chased" is recorded with no message actually delivered.
- **Nexus import depends on the exact partner name** `"Nexus Security"` (`NEXUS_PARTNER_NAME`) existing first (seeded). Rate columns and postcode parsing are hard-coded to the Nexus CSV shape.
- **`assignAdmin*` requires `recordedByPartner=false`**; partner-recorded rows are edited via `updatePartnerActivity` instead — two different code paths for "set the officer/rate", easy to cross-wire.
