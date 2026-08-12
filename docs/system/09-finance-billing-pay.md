# Finance: Billing, Rates & Pay

> How 1st Nationwide Ops prices each activity for the customer, pays the attending officer, snapshots both amounts onto the activity row, and rolls them up into P&L, payroll and month-end pay-summary SMS — all driven by four rate-card models and one pure calculator (`src/lib/billing.ts`).

Cross-references: activity creation/completion in `06-dispatch-jobs-alarms.md`; the three partner relationship modes in `08-partners.md`; scheduled cron jobs in `13-crons.md`.

---

## Purpose & scope

Finance answers three questions for every unit of work:

1. **What do we bill the customer?** — resolved from `SiteRate`/`CustomerRate`, written to `billedAmount`.
2. **What do we pay our officer?** — resolved from `OfficerRate`, written to `paidAmount` (only when an internal officer attended).
3. **What does the partner charge us / pay their officer?** — captured from `PartnerRate` onto `partnerChargeToUsAmount` / `partnerOfficerPayAmount` for partner-recorded work.

The unit of work is a `Job`, a `PatrolVisit`, or a `Shift`. Each carries its own **finance snapshot** — amounts are computed once and frozen on the row so later rate-card edits never rewrite history. `/finance`, `/finance/payroll`, the CSV export and the pay-summary SMS all read those snapshots; they never re-derive prices at read time.

Out of scope here: VAT/invoicing (not modelled), subscription (`ANNUAL_SUBSCRIPTION`) and one-off `SITE_SETUP` billing (priceable services with no `JobType` mapping — not auto-billed from activity).

---

## Data model

Four rate models, all keyed by `RateService` + `RateUnit` (see `01-data-model.md`):

| Model | Scope key | Purpose | Notable fields |
| --- | --- | --- | --- |
| `SiteRate` | `@@unique([siteId, service])` | Per-site customer price **override** | `amount Decimal(10,2)`, `unit`, `includedMinutes`, `excessRatePerMin Decimal(10,4)` |
| `CustomerRate` | `@@unique([customerId, service])` | Customer **default** card (applies to all its sites) | same shape as `SiteRate` |
| `OfficerRate` | `@@unique([officerId, service])`; `officerId` null = **company default** | What we pay an officer | same shape; a `PER_MONTH` row = the monthly retainer |
| `PartnerRate` | `@@unique([partnerId, service])` | Two-sided partner card | `chargeToUs`, `payToOfficer` |

**Snapshot columns** live on the activity rows themselves:

- `Job` / `PatrolVisit` / `Shift`: `billedAmount`, `billedCurrency`, `billedAt`, `payRateUnit`, `paidAmount`, `paidCurrency`, `paidAt`.
- `Job` / `Shift` additionally: `partnerChargeToUsAmount`, `partnerOfficerPayAmount` (partner-side cost, set directly, not via the calculator).
- `Shift` additionally: `payableMinutes` (worked minutes rounded up to the next 30-min block — the pay basis).

`RateService` values: `ALARM_RESPONSE, KEYHOLDING, LOCKUP, UNLOCK, VPI, PATROL, STATIC_GUARDING, DOG_HANDLER, ADHOC, ANNUAL_SUBSCRIPTION, SITE_SETUP`.
`RateUnit` values: `PER_VISIT, PER_HOUR, PER_MONTH, PER_YEAR, FIXED`.

---

## Key files

| File | Responsibility |
| --- | --- |
| `src/lib/billing.ts` | The calculator. Pure functions (`calculateBilling`, `calculatePay`, `mergeRates`, `jobTypeToRateService`, `durationMinutes`, `roundUpToHalfHour`, `jobAccountingDate`/`visitAccountingDate`/`shiftAccountingDate`) + DB helpers (`billForSite`, `payForOfficer`, `applyBillingTo{Visit,Job,Shift}`, `applyPayTo{Visit,Job,Shift}`, `snapshotJobFinanceIfNeeded`). |
| `src/lib/activityWhen.ts` | Canonical "when" for an activity — display (`jobWhen`/`visitWhen`/`shiftWhen`) and the scheduled-date Prisma window fragments (`jobScheduledRange`/`visitScheduledRange`/`shiftScheduledRange`) used by every finance/payroll query. |
| `src/lib/payroll.ts` | `buildPayrollReport`, `monthsBetween`, `csvHeader`/`csvLineFor` — month roll-up + CSV shaping. |
| `src/lib/rateMeta.ts` | Canonical service/unit lists, labels (`SERVICE_LABEL`, `UNIT_LABEL`), `fmtMoney`, `RateFormState`. |
| `src/lib/rateInput.ts` | Zod `RateCardInput` + `parseRateForm` + `rateData` — shared validation/shaping for the `SiteRate`/`CustomerRate` editors. |
| `src/app/(app)/finance/page.tsx` | Finance dashboard — KPIs, 14-day trend, revenue by service/region, P&L by account, top sites, officer & partner tables. |
| `src/app/(app)/finance/_actions.ts` | `recalculateBilling` — the "Bill missing" / "Recompute" bulk action. |
| `src/app/(app)/finance/activities/page.tsx` | Admin activity ledger with billed/paid columns + group-by pivot. |
| `src/app/(app)/finance/officers/[id]/page.tsx`, `.../partners/[id]/page.tsx` | Per-account drill-downs. |
| `src/app/(app)/finance/payroll/page.tsx` | Payroll table (retainer + activity pay). |
| `src/app/api/payroll/export/route.ts` | `GET /api/payroll/export?from&to` → CSV. |
| `src/app/api/cron/pay-summary/route.ts` | Month-end officer pay-summary SMS. |
| Rate editors | `src/app/(app)/admin/customers/[id]/rates/` (customer card), `src/app/(app)/sites/[id]/_components/SiteRatesEditor.tsx` + `_actions.ts` (site overrides), `src/app/(app)/admin/officer-rates/` (officer pay), `src/components/RateCardForm.tsx` (shared form). |
| Create-time callers | `src/lib/scheduleSync.ts`, `src/lib/callouts.ts`, `src/app/(app)/dispatch/_actions.ts`, `.../dispatch/callouts/_actions.ts`, `.../onboarding/_actions.ts`, `.../patrols/_actions.ts`, `.../shifts/_actions.ts`, `src/lib/jobActions.ts`, `src/app/api/submissions/route.ts`, `src/app/duty/[token]/_actions.ts`, `src/app/api/telegram/webhook/route.ts`. |
| Partner-side | `src/app/partner/activities/_actions.ts` — sets partner charge/pay directly from `PartnerRate` (`getPartnerRateForType`). |

---

## Core flows

### 1. Rate resolution (`billForSite`)
```
site.rates (SiteRate[])  ┐
                         ├─ mergeRates → site wins per service ─→ calculateBilling(service, duration)
customer.rates (CustomerRate[]) ┘
```
`billForSite(siteId, service, durationMinutes?)` loads the site's own rates and its customer's default card, merges them (`mergeRates` — customer defaults first, site rates overwrite per service), then runs `calculateBilling`. A site with no customer falls back to site rates only.

`calculateBilling(rates, service, duration)` picks the first rate for `service` and returns a discriminated result:
- `PER_HOUR` → `amount = rate.amount × (duration/60)`; returns `{ ok:false, reason:"duration_required" }` if duration is missing/≤0.
- Any other unit → flat `rate.amount` **plus** an excess surcharge: `(duration − includedMinutes) × excessRatePerMin` when `duration > includedMinutes` and both are set.
- No matching rate → `{ ok:false, reason:"no_rate" }`.
- All money rounded via `round2`.

`jobTypeToRateService` maps activity type → `RateService` (`LOCK→LOCKUP`, `KEY_COLLECTION`/`KEY_DROPOFF→KEYHOLDING`, `*_SHIFT→STATIC_GUARDING`/`DOG_HANDLER`, etc.). It returns `null` for unpriced types (e.g. `SURVEY`) — those are never billed.

### 2. Billing a job / visit / shift at create time
When an activity is created **with a fixed unit and a known account**, billing + pay are snapshotted immediately, stamped with the **scheduled date** so the amount lands in the right month:
- **Scheduled jobs** (`scheduleSync.ts` nightly cron, dispatch callouts, onboarding, Telegram callouts): `billForSite` → `applyBillingToJob`, then `payForOfficer` → `applyPayToJob`, `at = scheduledFor`.
- **Patrol visits**: on `/submit` (`api/submissions/route.ts`) and patrol actions, `billForSite(…, duration)` → `applyBillingToVisit`, `payForOfficer` → `applyPayToVisit`, `at = scheduleDate ?? scheduledAt`.
- **Shifts**: billed on **actual worked minutes**, officer paid on **`payableMinutes`** (30-min-rounded). Both the staff completion action (`shifts/_actions.ts`) and the token duty page (`duty/[token]/_actions.ts`) call `billForSite`/`applyBillingToShift` + `payForOfficer`/`applyPayToShift`, `at = scheduledStartsAt`.

`snapshotJobFinanceIfNeeded(jobId)` is the completion-time backstop: it fills **only still-null** `billedAmount`/`paidAmount` on a completed job, stamped at `jobAccountingDate` (scheduled date, else completion). Called on job close (`jobActions.ts`), admin approve (`admin/reports/_actions.ts`), `/submit`, and Telegram complete — closing the gap where a PER_HOUR or approval-lagged job would otherwise keep `paidAmount = null` and drop out of payroll.

### 3. "Bill missing" backfill / recompute (`recalculateBilling`)
`src/app/(app)/finance/_actions.ts`, admin-only, triggered by the `RecalcButton` on `/finance` (over the selected date window):
- `scope="missing"` (default) — only rows with `billedAmount = null`, **or** jobs attended by an officer but with `paidAmount = null` (the payroll gap).
- `scope="all"` — re-snapshot every completed visit / non-cancelled job / completed shift in the window.
- Performance: pre-fetches all `SiteRate`, `OfficerRate`, `CustomerRate` and site owners in a handful of bulk queries (not N+1), computes in memory, writes in parallel chunks of 25 (rows capped at 5000 per type).
- **Self-heal**: while it has each job's site in hand, if the job's `customerId`/`partnerId` is null but the site now has one, it backfills the job's account column in the same update.
- **Idempotent**: always overwrites, and stamps `billedAt`/`paidAt` with the **work/accounting date** (not `now`), so re-runs keep each amount in its original month. Cancelled jobs are always excluded (Restore is the only path back).

### 4. Officer pay (`calculatePay` / `payForOfficer`)
`payForOfficer(officerId, service, duration)` loads that officer's rates plus company defaults (`officerId = null`) and runs `calculatePay`, where a **per-officer rate beats the company default** for the same service. Same `PER_HOUR`/excess/`no_rate` semantics as billing. Pay is written **only when an internal officer attended** — partner-handled activity leaves `paidAmount` null and carries its cost on `partnerChargeToUsAmount` instead.

### 5. Payroll export (`buildPayrollReport` → CSV)
`buildPayrollReport(from, to)` (`payroll.ts`) produces one row per active `OFFICER`/`DISPATCHER` (including zero-pay officers, so gaps are visible):
- **Retainer** = the officer's `PER_MONTH` `OfficerRate` (per-officer, else company default; `ANNUAL_SUBSCRIPTION` accepted as legacy) × `monthsBetween(from,to)` (partial months count as whole).
- **Activity pay** = sum of `paidAmount` over that officer's `COMPLETED` `PatrolVisit`s and completed `Job`s whose scheduled date falls in the window (via `visitScheduledRange`/`jobScheduledRange`, requiring `paidAt` set).
- `total = retainer + activityPay`. `/api/payroll/export` returns `csvHeader()` + `csvLineFor()` rows as `text/csv` (admin-only; validates `from`/`to`). `/finance/payroll` renders the same report on screen.

### 6. P&L (`/finance`)
`finance/page.tsx` (admin-only, default range = current month) reads snapshots over the scheduled-date window, counting **only completed work** (`status=COMPLETED` visits/shifts, `completedAt`-set non-cancelled jobs):
- KPIs: earned today / in range / previous same-length period, with % delta; 14-day billed sparkline via raw SQL over `departedAt`/`completedAt`/`actualEndedAt`.
- **P&L by account** (customer / partner / unassigned): `profit = billed − paid`; for shifts, `partnerChargeToUsAmount` is folded into `paid` so profit reflects real outgoings whether an officer or a subcontractor did the work. Jobs fall back to the **site's** customer/partner when the job's own column is null.
- Officer table (pay per officer), **two-sided partner** table (`asCustomer` = billed to them; `asSubcontractor` = billed to our end customer), top sites by revenue/activity, revenue by service and by region.

---

## Business rules & invariants

- **Customer defaults + per-site overrides, site wins.** `mergeRates` layers `SiteRate` over `CustomerRate` per service. The `SiteRatesEditor` shows each service's *effective* rate tagged `Site` / `Customer default` / `Not set`; removing a site override falls the service back to the customer default.
- **Snapshot at create/complete, frozen thereafter.** Amounts are written once onto the row; editing a rate card does **not** retroactively change billed history. Recompute is the only way to re-price, and it is explicit and admin-triggered.
- **Idempotent recompute.** Every apply/recompute overwrites the snapshot and stamps the accounting/work date, so running it twice (or after the fact) is safe and month-stable.
- **Accounting date = scheduled date, else completion.** `jobAccountingDate`/`visitAccountingDate`/`shiftAccountingDate` and the `*ScheduledRange` window fragments anchor everything on the rota date. Work scheduled on the 30th but finished on the 1st still counts in the scheduled month, across P&L, payroll and pay-summary alike.
- **Officer pay only when WE attend.** `paidAmount` is set solely for internal officers; partner-handled jobs/shifts leave it null.
- **Partner charge/pay are direct snapshots.** `partnerChargeToUsAmount` / `partnerOfficerPayAmount` are captured from `PartnerRate` at create time (via `getPartnerRateForType`) and are **overridable on the partner form** — they do **not** flow through `calculateBilling`/`calculatePay`.
- **PER_HOUR needs a duration; excess is time-over-included.** Missing duration → `duration_required` (no snapshot). Excess surcharge only applies when `includedMinutes` and `excessRatePerMin` are both set and duration exceeds the window.
- **Shift pay basis is rounded up to 30 minutes.** `roundUpToHalfHour` (1→30, 31→60, 431→450); billing uses actual worked minutes, pay uses `payableMinutes`.
- **Unpriced services aren't billed.** `jobTypeToRateService` → null (e.g. `SURVEY`), and `no_rate`/`duration_required` outcomes clear the snapshot columns rather than guess.
- **Input bounds** (`rateInput.ts`): amount 0–1,000,000; `includedMinutes` 0–1440; `excessRatePerMin` 0–1000; currency exactly 3 chars (upper-cased, default GBP).

---

## Entry points

| Surface | Path / trigger | Auth |
| --- | --- | --- |
| Customer default rate card | `/admin/customers/[id]/rates` → `upsertCustomerRate`/`deleteCustomerRate` | admin |
| Per-site rate overrides | Site detail Finance tab (`SiteRatesEditor`) → `upsertSiteRate`/`deleteSiteRate` | admin |
| Officer pay rates | `/admin/officer-rates` → `upsertOfficerRate`/`deleteOfficerRate` (custom upsert — unique key includes nullable `officerId`) | admin |
| Partner rate card | partner portal (feeds `getPartnerRateForType`) | partner |
| Finance dashboard + Recompute | `/finance` → `recalculateBilling(scope, {from,to})` | admin |
| Activity ledger | `/finance/activities` (+ `/api/activities/export`) | admin |
| Officer / partner drill-down | `/finance/officers/[id]`, `/finance/partners/[id]` | admin |
| Payroll | `/finance/payroll`; CSV `GET /api/payroll/export?from&to` | admin |
| Month-end pay SMS | `GET /api/cron/pay-summary` (cron secret; `?force=YYYY-MM` to override month) | cron |

---

## Extension points & gotchas

- **Payroll omits shift pay.** `buildPayrollReport` sums activity pay from `PatrolVisit` + `Job` only — **not** `Shift`. Yet `/api/cron/pay-summary` *does* include `Shift.paidAmount`, and `/finance` officer P&L includes shifts. An officer paid only via shifts shows £0 activity pay in the payroll CSV but a non-zero pay-summary SMS. Reconcile these when rebuilding.
- **Currency is assumed GBP in roll-ups.** `payByOfficer` and the P&L aggregations hard-code `"GBP"`; mixed-currency data would mis-total. Snapshots do store `billedCurrency`/`paidCurrency`, so the data is there to fix this.
- **"They did for us" only partially modelled.** For subcontracted jobs, `billedAmount` is what we charged the end customer; what we owe the partner is captured on `partnerChargeToUsAmount` **only** when the partner records/assigns the row (Phase 2). The `/finance/partners/[id]` "They invoiced us" column shows `—` until then.
- **Mixed create-time vs completion-time snapshots.** Fixed-unit scheduled jobs are billed at creation; PER_HOUR and duration-based work must wait for completion. `snapshotJobFinanceIfNeeded` only fills nulls, so a job whose rate changed after a partial snapshot won't self-correct without a `scope="all"` recompute.
- **`no_rate` is silent.** A site with neither a site rate nor a customer default for the service produces no snapshot and simply doesn't appear in billed totals — it isn't flagged. After importing sites, run **Bill missing** and watch for `visitsScanned`/`jobsScanned` far exceeding `…Billed`.
- **Recompute caps at 5000 rows per type per run.** Large historical backfills need windowing by date.
- **`ANNUAL_SUBSCRIPTION` / `SITE_SETUP` have no `JobType`.** They are priceable on the rate cards but never auto-billed from an activity — recurring subscription revenue and setup fees would need a separate billing path.
- **Duplicate service label maps.** `SERVICE_LABEL` lives in `rateMeta.ts` but several pages (`finance/page.tsx`, `finance/activities`, officer-rates) keep their own copies with slightly different wording (e.g. `ANNUAL_SUBSCRIPTION` = "Annual subscription" vs "Monthly retainer"). Consolidate on rebuild.
