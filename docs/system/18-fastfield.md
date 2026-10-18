# 18 — FastField reports

## Purpose & scope

Our officers file their own callout reports (Shurgard and one or two other clients) on **FastField**, not on `/submit`. This imports those reports and **attaches each one to the activity it's about** — the callout job, patrol visit or lock/unlock — so the activity shows the officer's report, photos and times, is marked done, and is billed and paid exactly as if the officer had used `/submit`.

FastField offers no webhook on our plan, so a **browser robot** reads the FastField web portal every 4 hours (GitHub Actions), the same way the Nexus and Keyholding syncs work.

- In scope: reading FastField submissions, copying photos/signatures, matching to site + activity, creating the Shurgard callout when nothing matches, the `/admin/fastfield` page for forms and hand-linking.
- Out of scope: sending anything to FastField (read-only), the reports FastField itself emails to clients (unchanged), editing a report after import (FastField stays the original).

## Data model

Migration `20261018120000_fastfield_import` (additive only).

| Model | What it is |
|---|---|
| `FastFieldForm` | One FastField form, keyed by FastField's own `formId` (549243 = the Shurgard activity log / call-out form). `customerId?` = the client whose sites its reports are matched against. `enabled` = import its submissions. `createJobs` + `jobType` = when a report matches nothing, create that job (Shurgard: callouts). `lastSeenAt` = last time the robot listed it. |
| `FastFieldReport` | One imported submission, keyed by FastField's `submissionId` (unique → re-imports are no-ops). Holds the answers in form order (`answers Json` = `[{ key, label, type, value, at?, lat?, lng? }]`, photos already replaced by our URLs), `photoUrls`, `signatureUrl`, the typed `siteText`/`officerText`, GPS, `submittedAt`/`startedAt`/`finishedAt`, and the outcome: `status` (`LINKED` / `CREATED` / `UNMATCHED` / `IGNORED`), `note` (how it was matched or why not), `siteId?`, `jobId?` or `patrolVisitId?`, `formSubmissionId?` (unique), `jobCreated`. |

A linked report also gets a normal **`FormSubmission`** (+ `ReportReview` with status `APPROVED`) on the job/visit, so everything that lists submissions — the job page, the patrol visit page, the review queue, officer filters — sees it. Its `payload` is just `{ source: "fastfield", fastfield: { submissionId, formId, formName }, photoUrls, signatureUrl? }`; the answers live on the `FastFieldReport` (the review page reads them through `FormSubmission.fastfieldReport`).

## Key files

| File | Role |
|---|---|
| `scripts/fastfield-forms.mjs` | The robot: login, list, plan, read each submission, copy media, send. Counts-only logs. |
| `.github/workflows/partner-syncs.yml` (step 4) | The 4-hourly run: last 3 days, 8-minute limit. |
| `.github/workflows/fastfield-forms.yml` | Manual run: From/To dates, Preview (default on), 110-minute limit — the backfill. |
| `src/app/api/imports/fastfield/route.ts` | `plan` / `import` / `retry` actions; `?preview=1`. Bearer `NEXUS_IMPORT_SECRET`, fail-closed. |
| `src/app/api/imports/fastfield/photo/route.ts` | One photo per request → Vercel Blob `uploads/fastfield/<submission>/…` (random suffix). |
| `src/lib/fastfield.ts` | Pure: reading facts from the answers, site / officer / activity choice. Tests: `fastfield.test.ts`. |
| `src/lib/fastfieldImport.ts` | Database side: forms, plan, import, retry, and the attach functions (also used by the admin page). |
| `src/app/(app)/admin/fastfield/*` | Forms (client, import on/off, create callouts), "Needs linking", recently attached; `[id]` = one report with hand-linking. |
| `src/components/FastFieldAnswers.tsx` | Renders a report's answers (photos, signature, GPS) — used by `/admin/fastfield/[id]` and `/admin/reports/[id]`. |
| `scripts/fastfield-discovery.mjs` + `fastfield-discovery.yml` | The manual, value-masked portal explorer used to build the robot. Keep for debugging portal changes. |

## Core flows

### The robot (every 4 hours, and by hand)

1. Log into `portal.fastfieldforms.com` (`#email` / `#pwd`; stops with a clear message on a 2-step code, a new-location check or a multi-account login).
2. `Dashboard.GetDashboards` → the dashboard's *Recent Submissions* card + `allForms` (form ids and names).
3. `Dashboard.GetCardData` for that card with `selectedUser: "All Users"`, the date window, 500 per page → every submission id + form name.
4. `POST /api/imports/fastfield { action: "plan" }` → the app records the forms (new ones get defaults, see below) and returns the ids that are **new** and on a form that's **switched on**.
5. For each new id, three at a time: `Submission.GetSubmissionData` → the answers in form order (values from `submission`, labels/types from `form`, capture times/GPS from `formMetaData.fieldMetaData`). Photos and the signature (`media` list) are fetched via `/api/media/amazon/<key>/redirect`, shrunk in the browser to ≤ 1600 px JPEG (originals ≤ 1.2 MB kept as is), and uploaded to `./photo`.
6. `POST { action: "import", reports }` (≤ 3 per call). If the app refuses a batch, the reports go one by one so one odd report can't block the rest.
7. `POST { action: "retry" }` — re-tries the last 7 days' unmatched reports (an activity may have been logged since).

It stops starting new reports at the time limit; the next run carries on (plan skips everything already imported). **Preview** copies no photos and writes nothing except the form list; it prints what would happen.

### Matching one report (`importFastField` → `decide`)

1. **Facts** (`extractFacts`): the site = first text answer labelled like *Site / Premises / Property / Address* (not *customer*); the officer = an *Officer / Guard / SIA* answer, else a bare *… Name*; a 16-digit SIA number is split off. Arrival / departure = time answers labelled *Arrive / On site / Start* and *Depart / Off / Finish / Left*, kept only if within 72 h before / 1 h after submission. **The moment used** = arrival, else when the form was opened on the phone, else submission. GPS = a location answer, else wherever a field captured the phone.
2. **Site** (`pickSite`) among the form's client's active sites: the Telegram bot's fuzzy name match (`matchSite`); several hits → the one within 2 km of the GPS; no hit → the site within 500 m of the GPS.
3. **Activity** (`pickActivity`): jobs (not cancelled, not partner-handled, not shift jobs, not a visit's job) and patrol visits at that site with any time within **3 hours**. Nearest wins; an activity of the form's own type counts as 30 min closer. If the runner-up is within 20 min of the winner it's **ambiguous** → left for a person. Activities that already have a FastField report are **taken**.
4. **Outcome**: a pick → **LINKED**. Nothing at all near the time and the form has *create* on → **CREATED** (a completed job of the form's type). Otherwise **UNMATCHED** with a note: site not recognised, nothing near the time, already has a report, or two equally close.

### Attaching (`linkReportToJob` / `linkReportToVisit` / `createJobForReport`)

One transaction: `FormSubmission` (form type from the activity, officer name from the form, matched officer as `submittedByUserId`, arrival/departure) + `ReportReview` **APPROVED** ("Imported from FastField.") + the activity update + the report's status/links. Then the finance snapshot:

- **Job**: unfinished statuses → `APPROVED`; fills `startedAt` (arrival — feeds the alarm SLA), `completedAt` (departure, else submission), GPS and — if nobody's assigned and it isn't partner work — the matched officer. Then `snapshotJobFinanceIfNeeded` (billing + officer pay, only where still empty).
- **Patrol visit**: → `COMPLETED`; keeps existing arrival/departure, fills the rest, GPS, photos (if it has none), officer (if none). Billing + pay at the PATROL rate where still empty, dated to the scheduled night.
- **Created job**: type from the form (`ALARM_RESPONSE` → source `ALARM`, else `CUSTOMER_REQUEST`), status `APPROVED`, the site's customer/partner, `INTERNAL_OFFICER` + matched officer, arrival/departure times, note "Recorded from the FastField report …". It shows in the Shurgard daily report like any completed callout.

No `ClientReport`, no customer SMS ack, no visit-completed notification — the client already had FastField's own report, and imports can be weeks old.

## Business rules & invariants

- **Everything starts switched off.** A form seen for the first time is recorded with `enabled = false`. The Shurgard form (id 549243, or any name containing "Shurgard") is pre-set to the Shurgard customer with *create callouts* on; another form is pre-pointed at a customer only when exactly one customer's full name appears in its name. An admin switches forms on at `/admin/fastfield` after a preview. A preview treats forms that have a client set as on.
- **One report per activity by the robot.** A taken activity is never auto-linked again, and a callout is only created when *no* activity at all is near the time — so two reports of one callout never create two jobs (the second waits as "already has a report"). By hand, an admin may link a second report to the same activity.
- **Idempotent.** `submissionId` is unique; plan skips imported ids; an overlapping run's insert hits P2002 and counts as already imported.
- **Never overwrite.** Attaching only fills empty job/visit times, GPS, officer and finance; it never changes a finished status (`SENT_TO_CLIENT`, `CLOSED`, …).
- **Privacy.** The robot logs counts only and saves no capture files (the repo's Actions logs are visible to anyone with access). Photos are public Blob URLs with a random suffix, under `uploads/` → the same **180-day** retention as officers' own photos (originals stay in FastField).

## Entry points

| Entry | Who | What |
|---|---|---|
| `POST /api/imports/fastfield` | the robot (bearer) | `plan`, `import`, `retry`; `?preview=1` |
| `POST /api/imports/fastfield/photo?submission=&name=` | the robot (bearer) | one JPEG/PNG/WebP ≤ 4 MB → `{ url }` |
| `/admin/fastfield` | admin | forms settings, "Needs linking", "Try matching again", recently attached |
| `/admin/fastfield/[id]` | admin | one report: answers, photos, how it matched; link to an activity at a chosen site, create the job, set aside |
| `/admin/reports/[id]` | admin, dispatcher | a FastField-sourced submission shows the FastField answers |

## Extension points & gotchas

- **Portal changes.** The robot relies on FastField's internal portal commands (not a public API). If FastField changes them, run **FastField discovery** (manual, values masked) and compare. The *Recent Submissions* card must stay on the robot login's dashboard.
- **Volume.** About 60 submissions a day across all forms; the Shurgard form is used for patrols and lock-ups as well as callouts, which is why matching prefers the nearest activity and only creates a job when nothing at all is near. If a preview shows far more *created* than expected, Shurgard patrols / lock-ups probably aren't scheduled in the app for those sites.
- **Three-state answers** are shown 0 = No, 1 = Yes, 2 = N/A, like the app's own tri fields.
- **Repeating sections** in a form are kept as raw values; their photos are still copied (listed under "Other photos").
- **A different login.** The robot needs a single-account FastField login without 2-step verification; the `FASTFIELD_ORG_ID` secret is only used by the discovery robot.
