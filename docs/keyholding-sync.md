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
- Tied to the **Keyholding Company** partner, `reportedViaPartnerApp = true`
  (their app is the record — no client report).
- **Type** from Service: Unlock / Lock / Patrol (external & internal) /
  Alarm response / Survey / Ad-hoc (welfare checks).
- **Status** from Execution Status: Done → completed, Cancelled → cancelled,
  At Location → in progress, Booked / Allocated / Waiting → open (to allocate).
- **Times:** Date → scheduled, Started/On Site → started, Finished/Leave Site
  → completed.
- **Officer: left unallocated** — the Executor column is ignored and the
  office allocates; re-imports never touch an allocation.
- **Site:** matched by the postcode in Addresses (then property name). Jobs
  that look like one already in the system (same site, type and time — hand
  entered or generated from a schedule) are created with the ⚠ **Possible
  duplicate** flag so the office can reconcile them; nothing is merged
  silently.

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
