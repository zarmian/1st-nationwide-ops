# Finance: Billing, Rates & Pay

> How 1st Nationwide Ops prices each activity for the customer, pays the attending officer, snapshots both amounts onto the activity row, and rolls them up into P&L, payroll, the month-end pay-summary SMS, **customer invoices (with VAT) that can be emailed, part-paid and auto-chased, an aged-debt/receivables report, a full VAT-return summary (output _and_ input VAT), supplier-cost tracking, credit notes, customer account statements, partner reconciliation statements, recurring/subscription billing, officer payslips with manual pay adjustments, and CSV exports for the accountant** — all driven by four rate-card models and one pure calculator (`src/lib/billing.ts`).

Cross-references: activity creation/completion in `06-dispatch-jobs-alarms.md`; the three partner relationship modes in `08-partners.md`; scheduled cron jobs in `13-crons.md`.

---

## Purpose & scope

Finance answers three questions for every unit of work:

1. **What do we bill the customer?** — resolved from `SiteRate`/`CustomerRate`, written to `billedAmount`.
2. **What do we pay our officer?** — resolved from `OfficerRate`, written to `paidAmount` (only when an internal officer attended).
3. **What does the partner charge us / pay their officer?** — captured from `PartnerRate` onto `partnerChargeToUsAmount` / `partnerOfficerPayAmount` for partner-recorded work.

The unit of work is a `Job`, a `PatrolVisit`, or a `Shift`. Each carries its own **finance snapshot** — amounts are computed once and frozen on the row so later rate-card edits never rewrite history. `/finance`, `/finance/payroll`, the CSV export and the pay-summary SMS all read those snapshots; they never re-derive prices at read time.

Now **in** scope (added after the original build): **customer invoicing with VAT** (`Invoice`/`InvoiceLine`) that can be **emailed** and **part-paid** (`InvoicePayment`) and **auto-chased when overdue** (`InvoiceReminder`, a daily cron); an **aged-debt / receivables** report; a **VAT-return summary** with both **output VAT (sales)** and **input VAT (from `SupplierCost`)**; **supplier-cost tracking** (bills/overheads → true net profit); **credit notes** (`CreditNote`); **customer account statements**; **partner reconciliation statements**; a **billing/pay exceptions** report; **recurring/subscription billing** (`RecurringCharge` — retainers, subscriptions, one-off setup fees; independent of any `JobType`); **officer payslips** (PDF + email) with **manual pay adjustments** (`PayAdjustment`); and **CSV exports** (sales / payments / costs / payroll) for the accountant. Still out of scope: supplier-payment tracking (bills are recorded, not marked paid) and multi-currency (GBP is assumed in roll-ups).

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

- `Job` / `PatrolVisit` / `Shift`: `billedAmount`, `billedCurrency`, `billedAt`, `payRateUnit`, `paidAmount`, `paidCurrency`, `paidAt`, plus `invoiceId` (set when the row is placed on a customer invoice — stops double-invoicing).
- `Job` / `Shift` / `PatrolVisit`: `partnerChargeToUsAmount`, `partnerOfficerPayAmount` (partner-side cost, set directly, not via the calculator — visits capture it at materialisation from `PartnerRate`, keyed on the schedule kind).
- `Shift` additionally: `payableMinutes` (worked minutes rounded up to the next 30-min block — the pay basis).

`RateService` values: `ALARM_RESPONSE, KEYHOLDING, LOCKUP, UNLOCK, VPI, PATROL, STATIC_GUARDING, DOG_HANDLER, ADHOC, ANNUAL_SUBSCRIPTION, SITE_SETUP`.
`RateUnit` values: `PER_VISIT, PER_HOUR, PER_MONTH, PER_YEAR, FIXED`.

**Invoicing & recurring** (added — see `01-data-model.md`):

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `Invoice` | A customer invoice for a period | `number` (unique `INV-#####`), `status` (`InvoiceStatus`: DRAFT/SENT/PAID/VOID), `periodFrom/To`, `issuedAt`, `emailedAt`, `dueAt`, `subtotal`, `vatRate`, `vatAmount`, `total` |
| `InvoiceLine` | One line, grouped by service | `description`, `service`, `quantity`, `unitAmount`, `amount` |
| `InvoicePayment` | A payment (or part payment) received against an invoice | `invoiceId` (cascade), `amount`, `paidOn`, `method`, `reference`, `notes` |
| `RecurringCharge` | A standing charge on a cadence | `customerId`, `amount`, `cadence` (`RecurringCadence`: MONTHLY/QUARTERLY/ANNUAL/ONE_OFF), `startDate`, `endDate`, `active` |
| `RecurringChargeRun` | One occurrence of a recurring charge for a period | `periodKey` (`YYYY-MM` / `YYYY-Qn` / `YYYY` / `ONEOFF`), `amount`, `invoiceId`; `@@unique([recurringChargeId, periodKey])` |

Activities link to their invoice via `Job/PatrolVisit/Shift.invoiceId`; recurring occurrences via `RecurringChargeRun.invoiceId`. Voiding an invoice unlinks its activities and deletes its runs, freeing everything to bill again. Payments cascade-delete with their invoice; an invoice flips to `PAID` automatically once its payments cover the total (and back to `SENT` if a payment is removed).

**Officer pay adjustments:**

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `PayAdjustment` | A manual pay line for an officer, dated into a payslip period | `officerId` (cascade), `date`, `kind` (free label — Bonus / Expense / Holiday pay / Deduction / Correction / Other), `label`, `amount` (**signed** — negative subtracts), `note` |

**Costs, reminders & credit notes** (round-3 additions):

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `SupplierCost` | A bill / overhead we've incurred (purchase side) | `date` (tax point), `supplier`, `category` (free label), `net`/`vatRate`/`vatAmount`/`gross`, `reclaimable` (input VAT reclaimable?), `reference` |
| `InvoiceReminder` | Log of an overdue-invoice reminder email | `invoiceId` (cascade), `stage` (`overdue_1/7/14/30` or `manual`), `sentAt`, `toEmail`; `@@unique([invoiceId, stage])` so each stage fires once |
| `CreditNote` | Reduces what a customer owes | `number` (unique `CN-#####`), `customerId`, `invoiceId?` (SetNull), `status` (`CreditNoteStatus`: ISSUED/VOID), `issuedAt`, `reason`, `subtotal`/`vatRate`/`vatAmount`/`total` |

---

## Key files

| File | Responsibility |
| --- | --- |
| `src/lib/billing.ts` | The calculator. Pure functions (`calculateBilling`, `calculatePay`, `mergeRates`, `jobTypeToRateService`, `durationMinutes`, `roundUpToHalfHour`, `jobAccountingDate`/`visitAccountingDate`/`shiftAccountingDate`) + DB helpers (`billForSite`, `payForOfficer`, `applyBillingTo{Visit,Job,Shift}`, `applyPayTo{Visit,Job,Shift}`, `snapshotJobFinanceIfNeeded`). |
| `src/lib/activityWhen.ts` | Canonical "when" for an activity — display (`jobWhen`/`visitWhen`/`shiftWhen`) and the scheduled-date Prisma window fragments (`jobScheduledRange`/`visitScheduledRange`/`shiftScheduledRange`) used by every finance/payroll query. |
| `src/lib/payroll.ts` | `buildPayrollReport` (retainer + activity pay + **adjustments** → net), `monthsBetween`, `csvHeader`/`csvLineFor` — month roll-up + CSV shaping. |
| `src/lib/payslip.ts` | `loadPayslip` (per-officer statement: retainer + activity grouped by service + adjustments → gross/net) + `sendPayslipEmail`. |
| `src/lib/receivables.ts` | `loadReceivables` + `ageBucket` (unit-tested) — outstanding invoices aged current / 1–30 / 31–60 / 61–90 / 90+. |
| `src/lib/vatReturn.ts` | `loadVatReturn` (output VAT by invoice/tax-point date → Box 1 + Box 6, by-rate split) + `calendarQuarter`/`recentQuarters` (unit-tested). |
| `src/lib/accountingExport.ts` | Sales + payments CSV — pure row formatters (unit-tested) + loaders. |
| `src/lib/email.ts` | Resend wrapper (`isEmailConfigured`/`sendEmail`) — no-op until `RESEND_API_KEY` is set, mirroring `sms.ts`. |
| `src/lib/costs.ts` | `loadCosts` (period ledger + by-category) + `loadInputVat` (Box 4/7 for the VAT return). |
| `src/lib/reminders.ts` | Dunning: `REMINDER_STAGES`, `stageForDaysOverdue` (unit-tested), `computeDueReminders`, `sendDueReminders` (cron), `sendManualReminder`. |
| `src/lib/creditNotes.ts` | `createCreditNote`/`voidCreditNote` + PDF data loader. |
| `src/lib/customerStatement.ts` | `loadCustomerStatement` (opening balance + running balance) + `runningBalance` (unit-tested) + `sendCustomerStatementEmail`. |
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
| Exceptions | `src/lib/financeExceptions.ts` + `src/app/(app)/finance/exceptions/page.tsx` — completed work with no bill / no officer pay. |
| Invoicing | `src/lib/invoicing.ts` (preview / create / status, plus `recordPayment`/`deletePayment`/`sendInvoiceEmail`), `src/lib/company.ts` (supplier details — **fill in for a valid VAT invoice**), `src/app/(app)/finance/invoices/**`; PDF `src/lib/reports/InvoicePdf.tsx` + `src/app/api/invoices/[id]/pdf/route.ts`. |
| Receivables | `src/lib/receivables.ts`, `src/app/(app)/finance/receivables/page.tsx`. |
| VAT return | `src/lib/vatReturn.ts`, `src/app/(app)/finance/vat/page.tsx`. |
| Payslips | `src/lib/payslip.ts`, `src/app/(app)/finance/officers/[id]/payslip/**`; PDF `src/lib/reports/PayslipPdf.tsx` + `src/app/api/officers/[id]/payslip/pdf/route.ts`. |
| Accounting export | `src/lib/accountingExport.ts`, `src/app/(app)/finance/export/page.tsx`, `src/app/api/finance/export/{invoices,payments,costs}/route.ts`. |
| Supplier costs | `src/lib/costs.ts`, `src/app/(app)/finance/costs/**`. |
| Reminders (dunning) | `src/lib/reminders.ts`, `src/app/api/cron/invoice-reminders/route.ts`; manual button `InvoiceReminderButton.tsx`. |
| Credit notes | `src/lib/creditNotes.ts`, `src/app/(app)/finance/credit-notes/**`; PDF `src/lib/reports/CreditNotePdf.tsx` + `src/app/api/credit-notes/[id]/pdf/route.ts`. |
| Customer statements | `src/lib/customerStatement.ts`, `src/app/(app)/finance/statements/page.tsx` + `.../customers/[id]/statement/**`; PDF `src/lib/reports/CustomerStatementPdf.tsx` + `src/app/api/customers/[id]/statement/pdf/route.ts`. |
| Partner statements | `src/lib/partnerStatement.ts`, `src/app/(app)/finance/partners/[id]/statement/page.tsx`; PDF `src/lib/reports/PartnerStatementPdf.tsx` + `src/app/api/partners/[id]/statement/pdf/route.ts`. |
| Recurring | `src/lib/recurring.ts` (`periodsDue`, `dueRecurringLines` — unit-tested), `src/app/(app)/finance/recurring/**`; wired into `invoicing.ts`. |

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
- **Activity pay** = sum of `paidAmount` over that officer's `COMPLETED` `PatrolVisit`s, completed `Job`s and completed `Shift`s whose scheduled date falls in the window (via the `*ScheduledRange` fragments, requiring `paidAt` set).
- **Adjustments** = signed sum of that officer's `PayAdjustment` rows dated in the window.
- `total = retainer + activityPay + adjustments` (net pay). `/api/payroll/export` returns `csvHeader()` + `csvLineFor()` rows as `text/csv` (admin-only; validates `from`/`to`; includes an `adjustments` column). `/finance/payroll` renders the same report on screen with a **Payslip →** link per officer.

### 6. P&L (`/finance`)
`finance/page.tsx` (admin-only, default range = current month) reads snapshots over the scheduled-date window, counting **only completed work** (`status=COMPLETED` visits/shifts, `completedAt`-set non-cancelled jobs):
- KPIs: earned today / in range / previous same-length period, with % delta; 14-day billed sparkline via raw SQL over `departedAt`/`completedAt`/`actualEndedAt`.
- **P&L by account** (customer / partner / unassigned): `profit = billed − paid`; for shifts, `partnerChargeToUsAmount` is folded into `paid` so profit reflects real outgoings whether an officer or a subcontractor did the work. Jobs fall back to the **site's** customer/partner when the job's own column is null.
- Officer table (pay per officer), **two-sided partner** table (`asCustomer` = billed to them; `asSubcontractor` = billed to our end customer), top sites by revenue/activity, revenue by service and by region.

### 7. Billing / pay exceptions (`/finance/exceptions`)
`loadBillingExceptions(from, to)` (`financeExceptions.ts`) scans completed work in the window and flags rows with **no customer bill** (`billedAmount` null) or **no officer pay** (own officer attended, `paidAmount` null). Partner-billed rows are excluded so the list stays actionable. Read-only — the fix is a rate + **Bill missing**.

### 8. Customer invoicing (`/finance/invoices`)
`previewInvoice` / `createInvoice` (`invoicing.ts`) gather a customer's **completed, billed, un-invoiced** activity in a period (plus any due recurring charges — §10), group it into lines by service, apply one VAT rate, and create an `Invoice` (`INV-#####`) whose creation stamps every included activity + run with `invoiceId` in a transaction. Lifecycle `DRAFT → SENT` (stamps issue + due dates from `company.ts` terms) `→ PAID`, or `VOID` (unlinks activities, deletes runs). PDF via `InvoicePdf.tsx`. Amounts read the frozen snapshots — invoicing never re-prices.

**Send + payments.** `sendInvoiceEmail(id)` renders the PDF and emails it to the customer's `contactEmail` (via `lib/email.ts`); the first send from a draft issues the invoice (→ SENT + issue/due dates) so the ageing clock starts, and stamps `emailedAt`. `recordPayment` logs an `InvoicePayment` (part payments allowed) and auto-flips the invoice to `PAID` once payments cover the total; `deletePayment` reverts to `SENT` if that drops it back below total. The invoice detail page shows the payments list, live balance and a record-payment form.

### 8a. Receivables / aged debt (`/finance/receivables`)
`loadReceivables(asOf)` (`receivables.ts`) lists **issued invoices with a positive balance** (`SENT`, `balance = total − Σ payments`) aged by days past `dueAt` into **current / 1–30 / 31–60 / 61–90 / 90+** (`ageBucket`, unit-tested), most-overdue first, with per-bucket and per-customer totals.

### 8b. VAT return (`/finance/vat`)
`loadVatReturn(from, to)` (`vatReturn.ts`) sums **output VAT** on issued invoices by **invoice (tax-point) date** — **Box 1** (`Σ vatAmount`) and **Box 6** (`Σ subtotal`) — with a split by VAT rate and the invoice-level breakdown. Drafts and voided invoices are excluded. Calendar-quarter presets via `recentQuarters`. Output VAT only — purchase-side input VAT isn't tracked; the page says so.

### 8c. Accounting export (`/finance/export`)
`accountingExport.ts` produces period-scoped CSVs: **sales** (one row per issued invoice by tax-point date — net/VAT/gross/paid/balance), **payments received** (one row per `InvoicePayment` by payment date, for bank rec), and **supplier costs** (one row per bill, with the reclaimable flag), alongside the existing **payroll** CSV. Every cell is quoted; dates are ISO 8601. Pure row formatters are unit-tested; loaders read frozen figures.

### 8d. Supplier costs + input VAT (`/finance/costs`)
`costs.ts` records the **purchase side**: `SupplierCost` bills (subcontractors, fuel, vehicles, kit, insurance …) with net / VAT / gross, a category and a **reclaimable** flag; VAT + gross are derived from `net × rate`. `loadCosts(from, to)` totals them with a by-category split; `loadInputVat(from, to)` feeds the VAT return **Box 4** (reclaimable VAT) and **Box 7** (net purchases). The VAT return then also shows **Box 5** = Box 1 − Box 4 (net VAT to pay, or a reclaim), and `/finance` gains a true **Net profit** line = gross margin − net overheads.

### 8e. Overdue-invoice reminders / dunning (`/api/cron/invoice-reminders`)
`reminders.ts` chases unpaid invoices. The daily cron (08:00 UK) emails the customer for each `SENT` invoice with an outstanding balance that has crossed a dunning threshold (**1 / 7 / 14 / 30 days** overdue), sending only the **highest applicable unsent stage** — so a newly-tracked, already-overdue invoice gets one reminder, not a burst. `InvoiceReminder`'s `@@unique([invoiceId, stage])` guarantees one send per stage. A manual **Send reminder** button (`sendManualReminder`) chases on demand; last-reminded shows on the invoice and the receivables list. No-op until email is configured; missing customer emails are skipped.

### 8f. Credit notes (`/finance/credit-notes`)
`creditNotes.ts` issues a `CreditNote` (`CN-#####`) — a net + VAT amount with a reason, optionally linked to the invoice it credits (create it from the invoice's **Credit note** button or standalone). An ISSUED credit note **reduces the linked invoice's receivables balance** (§8a) and **nets off output VAT (Box 1) and sales (Box 6)** on the VAT return by issue date, adjusting the matching by-rate bucket. **Void** reverses both. PDF via `CreditNotePdf.tsx`.

### 8g. Customer statements (`/finance/statements`)
`customerStatement.ts` builds a per-customer **statement of account**: an opening balance (everything dated before the window) plus in-period invoices (+), payments (−) and credit notes (−) with a **running balance** (`runningBalance`, unit-tested) → closing balance, so it always reconciles. A chooser at `/finance/statements` lists customers with their outstanding balance; each statement has a period picker, PDF (`CustomerStatementPdf.tsx`) and **email to customer**.

### 9. Partner statements (`/finance/partners/[id]/statement`)
`loadPartnerStatement(partnerId, from, to)` (`partnerStatement.ts`) builds a two-sided reconciliation: **they owe us** (mode-2 work we billed them, `billedAmount`) vs **we owe them** (mode-3 jobs / shifts / patrol visits at `partnerChargeToUsAmount`), plus the net position. PDF via `PartnerStatementPdf.tsx`.

### 10. Recurring / subscription billing (`/finance/recurring`)
`periodsDue(charge, from, to)` (`recurring.ts`, unit-tested) computes the period keys a `RecurringCharge` is due for (MONTHLY/QUARTERLY/ANNUAL/ONE_OFF, respecting start/end); `dueRecurringLines` returns those not yet run. The invoice flow picks these up as lines and materialises one `RecurringChargeRun` per period (unique per charge + period, so never billed twice). Voiding an invoice deletes its runs.

### 11. Officer payslips + pay adjustments (`/finance/officers/[id]/payslip`)
`loadPayslip(officerId, from, to)` (`payslip.ts`) builds a per-officer statement using the **same rules as payroll** so the two reconcile: retainer (`PER_MONTH` `OfficerRate`, per-officer else company default × whole months) + activity pay (completed, paid visits/jobs/shifts on the scheduled-date window) **grouped by service**, plus **manual `PayAdjustment` lines** dated into the period → `gross` and `net`. Adjustments are added/deleted inline (signed amount — negative deducts). PDF via `PayslipPdf.tsx`; `sendPayslipEmail` emails it to the officer. Adjustments flow into `buildPayrollReport`'s net total and the payroll CSV.

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
| Billing / pay exceptions | `/finance/exceptions?from&to` | admin |
| Invoices | `/finance/invoices` (list), `/new` (preview → create), `/[id]` (detail + status + payments + email); PDF `GET /api/invoices/[id]/pdf` | admin |
| Receivables (aged debt) | `/finance/receivables` | admin |
| VAT return | `/finance/vat?from&to` (output + input VAT, Box 1/4/5/6/7) | admin |
| Supplier costs | `/finance/costs?from&to` → `addCostAction` / `deleteCostAction` | admin |
| Credit notes | `/finance/credit-notes` (list), `/new` (create), `/[id]` (detail + void); PDF `GET /api/credit-notes/[id]/pdf` | admin |
| Customer statements | `/finance/statements` (chooser), `/finance/customers/[id]/statement?from&to`; PDF `GET /api/customers/[id]/statement/pdf` | admin |
| Overdue reminders | `GET /api/cron/invoice-reminders` (cron secret; daily 08:00 UK) + manual button on a sent invoice | cron / admin |
| Payslips | `/finance/officers/[id]/payslip?from&to` (+ add/delete adjustments, email); PDF `GET /api/officers/[id]/payslip/pdf?from&to` | admin |
| Accounting export | `/finance/export` → CSV `GET /api/finance/export/{invoices,payments}?from&to` (+ `/api/payroll/export`) | admin |
| Partner statement | `/finance/partners/[id]/statement?from&to`; PDF `GET /api/partners/[id]/statement/pdf` | admin |
| Recurring charges | `/finance/recurring` → `addRecurringCharge` / `toggleRecurringCharge` / `deleteRecurringCharge` | admin |

---

## Extension points & gotchas

- **Payroll includes shift pay** (fixed). `buildPayrollReport` sums `PatrolVisit` + `Job` + `Shift` `paidAmount`, matching the pay-summary SMS and the `/finance` officer P&L. (This was a real bug — payroll excluded shifts, so a shift-only officer showed £0 on the CSV but non-zero elsewhere.)
- **Currency is assumed GBP in roll-ups.** `payByOfficer` and the P&L aggregations hard-code `"GBP"`; mixed-currency data would mis-total. Snapshots do store `billedCurrency`/`paidCurrency`, so the data is there to fix this.
- **"They did for us" is captured for jobs, shifts AND patrol visits.** `partnerChargeToUsAmount` is snapshotted from `PartnerRate` — visits at materialisation (`scheduleSync`, keyed on schedule kind), jobs/shifts when the partner records/assigns. **Bill missing** backfills visit partner-charges on existing rows. The partner **statement** reconciles both sides; the older `/finance/partners/[id]` "They invoiced us" column still shows `—` until the partner-side row is recorded.
- **Mixed create-time vs completion-time snapshots.** Fixed-unit scheduled jobs are billed at creation; PER_HOUR and duration-based work must wait for completion. `snapshotJobFinanceIfNeeded` only fills nulls, so a job whose rate changed after a partial snapshot won't self-correct without a `scope="all"` recompute.
- **`no_rate` is silent — but now surfaced.** A site with neither a site rate nor a customer default produces no snapshot and doesn't appear in billed totals. `/finance/exceptions` lists exactly these ("No bill"); set the rate and run **Bill missing**. Also watch `visitsScanned`/`jobsScanned` far exceeding `…Billed` on a recompute.
- **Recompute caps at 5000 rows per type per run.** Large historical backfills need windowing by date.
- **Subscriptions & setup fees bill via `RecurringCharge`** (not the activity path — they still have no `JobType`). Set them at `/finance/recurring`; each due period lands on the customer's next invoice. `ANNUAL_SUBSCRIPTION` also remains a `RateService`/`OfficerRate` unit for the officer monthly retainer.
- **Duplicate service label maps.** `SERVICE_LABEL` lives in `rateMeta.ts` but several pages (`finance/page.tsx`, `finance/activities`, officer-rates) keep their own copies with slightly different wording (e.g. `ANNUAL_SUBSCRIPTION` = "Annual subscription" vs "Monthly retainer"). Consolidate on rebuild.
- **Email is a no-op until configured.** `sendInvoiceEmail`/`sendPayslipEmail` return a clear "not set up yet" result unless `RESEND_API_KEY` is set (and `EMAIL_FROM` a verified sender), mirroring the SMS/WhatsApp drivers — nothing throws, the button just reports it. Set both in Vercel to enable.
- **"Mark paid" vs recorded payments.** The invoice status buttons still expose a manual **Mark paid** override; using it sets `PAID` without an `InvoicePayment`, so the payments card shows a full balance while the chip says paid. Prefer **Record payment** when you want the balance and the receivables/aged-debt figures to be right.
- **Receivables/VAT are invoice-date based, not cash.** Receivables ages by `dueAt`; the VAT return uses the invoice (tax-point) date. Businesses on the VAT cash-accounting scheme owe VAT when paid — the page flags this. The **payments** export is the cash-basis companion.
- **Payslip reconciles with payroll by construction** — both call the same retainer + paid-activity rules. If you change one, change the other (or extract the shared roll-up).
- **Costs use net for profit, reclaimable-only for Box 4.** `/finance` net profit deducts **net** supplier costs (VAT is passed through); the VAT return's Box 4 counts only costs flagged `reclaimable`. A cost's VAT + gross are derived from `net × rate` at save time — edit means delete + re-add.
- **Reminders send the highest unsent stage, never a backlog.** Adding the feature to a 90-days-overdue invoice sends one `overdue_30` reminder, then stops (no threshold beyond 30). The daily cron is safe to re-run; `@@unique([invoiceId, stage])` dedupes.
- **Credit notes and receivables/VAT.** A credit note only counts when `ISSUED`; voiding it reverses the balance reduction and the VAT net-off. The receivables `paid` column still shows payments only, so with a credit note `total − paid ≠ balance` by the credited amount — the **balance** is the correct figure.
- **Statements are computed, never stored.** `loadCustomerStatement` derives the opening/closing balance from live invoices/payments/credit notes each time, so a back-dated edit is reflected immediately; there's no period-close snapshot.
