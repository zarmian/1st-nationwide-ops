# Keyholding Company sync (Chase2Base jobs)

Keyholding Company's portal is **Chase2Base** (`chase2base.co.uk/app/#login`) —
a CUBA Platform / Vaadin 8 app with **no REST API** (everything syncs over
Vaadin UIDL). So a robot drives the real screen, like a person would.

## How it works

`scripts/keyholding-jobs.mjs` (workflow **Keyholding jobs**):

1. Logs in (`input.c-login-username` / `input.c-login-password` /
   `.c-login-submit-button`).
2. Opens **Jobs Management → Jobs** (click the `role=menuitem`, then "Jobs" in
   the popup).
3. Types the **From / To** dates into the two `input.v-datefield-textfield`
   (char-by-char + Tab — Vaadin ignores a raw fill; never Escape, it closes the
   screen) and clicks **Find**.
4. Reads the results table (Vaadin Table) — rows are `v-table-row` **and**
   `v-table-row-odd` — mapping the 34 cells by position, and pages with the
   CUBA **`.c-paging-next`** button (50 rows/page).
5. POSTs the rows (chunked) to `/api/imports/keyholding-jobs`.

Nightly at **07:00 UTC** it reads the **last 3 days → next 7 days** (recent
completions + upcoming jobs). On demand you can set any From/To (backfill) and
tick **Preview** for a dry run.

## What lands in the system (`src/lib/keyholdingJobs.ts`)

- One job per Keyholding job number (`#`, e.g. `J21634508`), stored in
  `Job.partnerActivityRef` — re-runs update, never duplicate.
- Keyholding is one of our **customers** (a Customer record, not a Partner).
  New jobs are tied to that customer (`customerId`), with
  `reportedViaPartnerApp = true` — their app is the record, so no /submit or
  client report from us. Source follows Keyholding's: "Scheduled" → scheduled,
  "Booked" → customer request. The customer is found by name ("Keyholding
  Company", or the single customer whose name contains "keyholding"/"khc";
  override with `KEYHOLDING_CUSTOMER_NAME`). If none/ambiguous, the run stops
  and lists the customers on file. Site matching prefers that customer's sites.
- **Type** from Service: Unlock / Lock / Patrol (external & internal) /
  Alarm response / Survey / Ad-hoc (welfare checks).
- **Status** from Execution Status: Done → completed, Cancelled → cancelled,
  At Location → in progress, Booked / Allocated / Waiting → open (to allocate).
- **Times:** Date → scheduled, Started/On Site → started, Finished/Leave Site
  → completed.
- **Officer: left unallocated** — the Executor column is ignored and the
  office allocates; re-imports never touch an allocation.
- **Site:** matched by the postcode in Addresses (then property name).
- **Link, don't duplicate.** Most of these jobs already exist — generated from
  the site's lock/unlock/patrol schedule, or entered by hand. So each Keyholding
  job is first **linked** to the existing job at the same site, same type,
  scheduled within ±3h (nearest in time, one-to-one, never one already linked).
  Linking attaches the `J…` number and brings the job up to date from
  Keyholding — but only ever moves it **forward** (never un-completes it),
  never touches a cancelled one, only fills attend/finish times that are
  missing, never changes the officer, customer/partner or billing, and
  **appends** a note rather than replacing. Only a job with **no** match is
  created. (The June→Sept backfill preview: 628 jobs, ~423 link to existing
  schedule jobs, the rest are new — on-demand jobs, alarm calls, etc.)

## Secrets

| Secret | Value |
| --- | --- |
| `KEYHOLDING_PORTAL_USERNAME` / `KEYHOLDING_PORTAL_PASSWORD` | Chase2Base login |
| `KEYHOLDING_JOBS_IMPORT_URL` | `https://1st-nationwide-ops.vercel.app/api/imports/keyholding-jobs` |
| `NEXUS_IMPORT_SECRET` | shared import secret (already set) |

Without `KEYHOLDING_JOBS_IMPORT_URL` the robot reads + saves the capture only.

`scripts/keyholding-discovery.mjs` (workflow **Keyholding discovery**) is the
capture tool used to reverse-engineer the screens — re-run it if Chase2Base
changes its layout.
