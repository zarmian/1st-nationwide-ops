# 18 — FastField reports

## Purpose & scope

Our officers file their own reports on **FastField**, not on `/submit`: callouts, lock-ups / unlocks, mobile patrols and the patrol rounds of static shifts. This imports those reports and **attaches each one to what it's about**: the static shift, callout job, patrol visit or lock/unlock. The activity then shows the officer's report, photos and times. Jobs and visits are also marked done and are billed and paid exactly as if the officer had used `/submit`.

FastField offers no webhook on our plan. A **browser robot** reads the FastField web portal every 4 hours (GitHub Actions), the same way the Nexus and Keyholding syncs work.

The forms in use (from the office):

| Form | Used for | Starting settings |
|---|---|---|
| Shurgard-titled form ("Shurgard callouts and lock ups / unlock report") | Shurgard callouts, lock-ups, unlocks | Shurgard sites only; creates the job at Shurgard sites |
| **Site Patrol Form** (FastField form 549243) | Static-shift patrol rounds at Shurgard sites, and patrols for other clients (e.g. Reay Security) | Any client; patrols / static shifts; never creates |
| **Alarm Response Form** | Alarm callouts for Shurgard and other clients | Any client; callouts; creates the callout only at Shurgard sites |

- **In scope:**
  - reading FastField submissions and copying photos and signatures;
  - matching each report to a site and an activity;
  - creating the job where the form says to;
  - the `/admin/fastfield` page for form settings, previews and linking by hand.
- **Out of scope:**
  - sending anything to FastField (the robot is read-only);
  - the reports FastField itself emails to clients (unchanged);
  - editing a report after import (FastField stays the original).

## Data model

Migrations:
- `20261018120000_fastfield_import`: the two tables.
- `20261018150000_fastfield_shifts_modes`: form modes, the create-for client, shift links and the presets above.

| Model | What it is |
|---|---|
| `FastFieldForm` | One FastField form, keyed by FastField's own `formId`. See the field list below. |
| `FastFieldReport` | One imported submission, keyed by FastField's `submissionId`, which is unique, so re-imports are no-ops. See the field list below. |

`FastFieldForm` fields:
- `mode`: `OFF`, `PREVIEW` (read only by preview runs, never imported) or `ON`.
- `jobType`: what the form reports. It is preferred when matching and is the job made when nothing matches.
- `customerId?`: match only this client's sites. Null means any client, and the site in each report decides.
- `createCustomerId?`: when a report matches nothing at **this** client's site, create the job. Null means never.
- `previewCounts`, `previewAt`, `previewRun`: what the last preview said this form's reports would do.
- `lastSeenAt`.

`FastFieldReport` fields:
- `answers Json`: the answers in form order, `[{ key, label, type, value, at?, lat?, lng? }]`, with photos already replaced by our URLs.
- `photoUrls`, `signatureUrl`.
- `siteText`, `officerText`: the site and officer as typed.
- GPS, plus `submittedAt`, `startedAt` and `finishedAt`.
- The outcome:
  - `status`: `LINKED`, `CREATED`, `UNMATCHED` or `IGNORED`;
  - `note`: how it was matched, or why not;
  - links: `siteId?`, then `jobId?`, `patrolVisitId?` or `shiftId?`;
  - `formSubmissionId?` (unique) and `jobCreated`.

A linked report also gets a normal **`FormSubmission`** with a `ReportReview` set to `APPROVED`:
- **On a job or visit**, the submission's form matches the activity.
- **On a shift**, the form is `PATROL` with `shiftId` set. It is not `SHIFT_CHECK`, so the duty-link check-in record and the shift report's check-in counts are untouched.

Everything that lists submissions sees it: the job, visit and shift pages, the review queue and the site history.

Its `payload` is `{ source: "fastfield", fastfield: { submissionId, formId, formName }, photoUrls, signatureUrl? }`. The answers themselves live on the `FastFieldReport`, and the review page reads them through `FormSubmission.fastfieldReport`. The Shurgard daily report's static-guarding section picks up `photoUrls` of shift-linked submissions, so patrol-round photos appear there, capped at 8 per shift like check-in photos.

## Key files

| File | Role |
|---|---|
| `scripts/fastfield-forms.mjs` | The robot: login, list, plan, read each submission, copy media, send. Counts-only logs, with per-form lines keyed by form number. |
| `.github/workflows/partner-syncs.yml` (step 4) | The 4-hourly run: last 3 days, 8-minute limit. |
| `.github/workflows/fastfield-forms.yml` | Manual run with From/To dates, Preview on by default, and a 110-minute limit. Used for previews and the backfill. |
| `src/app/api/imports/fastfield/route.ts` | Actions `plan`, `import` and `retry`, with `?preview=1` and a `run` id. Bearer `NEXUS_IMPORT_SECRET`, fail-closed. |
| `src/app/api/imports/fastfield/photo/route.ts` | Takes one photo per request and stores it in Vercel Blob under `uploads/fastfield/<submission>/…` with a random suffix. |
| `src/lib/fastfield.ts` | Pure functions: facts from the answers (site, postcode, officer, times, GPS, visit type) and the site, officer, shift and activity choice. Tests: `fastfield.test.ts`. |
| `src/lib/fastfieldImport.ts` | Database side: forms, plan, import, preview counts, retry, and the attach functions (also used by the admin page). |
| `src/app/(app)/admin/fastfield/*` | Forms (Import / Reports / Sites / Make the job, plus the last preview), "Needs linking", and recently attached reports. `[id]` shows one report with hand-linking. |
| `src/components/FastFieldAnswers.tsx` | Renders a report's answers (photos, signature, GPS). Used on `/admin/fastfield/[id]` and `/admin/reports/[id]`. |
| `scripts/fastfield-discovery.mjs` + `fastfield-discovery.yml` | The manual, value-masked portal explorer used to build the robot. Keep it for debugging portal changes. |

## Core flows

### The robot (every 4 hours, and by hand)

1. Log into `portal.fastfieldforms.com` (`#email` / `#pwd`). It stops with a clear message on a 2-step code, a new-location check or a multi-account login.
2. Call `Dashboard.GetDashboards` to get the dashboard's *Recent Submissions* card and `allForms` (form ids and names).
3. Call `Dashboard.GetCardData` for that card with `selectedUser: "All Users"` and the date window, 200 per page, to get every submission id and form name. If the login may not list all users, it falls back to the dashboard's own user filter.
4. `POST /api/imports/fastfield { action: "plan" }`. The app records the forms and returns the ids that are **new** and on a form that is **On**, or also **Preview only** in a preview run. A preview also clears the forms' last-preview counts under the run's id.
5. For each new id, three at a time:
   - `Submission.GetSubmissionData` gives the answers in form order (values from `submission`, labels and types from `form`, capture times and GPS from `formMetaData.fieldMetaData`).
   - Photos and the signature (`media` list) are fetched via `/api/media/amazon/<key>/redirect` and shrunk in the browser to a JPEG of at most 1600 px. Standard JPEG, PNG or WebP files of 1.2 MB or less are kept as they are.
   - Each one is uploaded to `./photo`. A preview copies nothing.
6. `POST { action: "import", run, reports }`, at most 3 per call. If the app refuses a batch, the reports go one by one so a single odd report can't block the rest.
7. `POST { action: "retry" }`, real runs only. This tries waiting reports again (see **Trying waiting reports again** below), in case a shift or job has been logged since.

It stops starting new reports at the time limit, and the next run carries on.

### Matching one report (`importFastField` → `decide`)

1. **Facts** (`extractFacts`):
   - **Site:** the first text answer labelled like *Site / Premises / Property / Address* (not *customer*).
   - **Postcode:** a UK postcode typed in that site answer, or in a *postcode/address* answer.
   - **Officer:** an *Officer / Guard / SIA* answer, else a bare *… Name*. A 16-digit SIA number is split off.
   - **Arrival and departure:** time answers labelled *Arrive / On site / Start* and *Depart / Off / Finish / Left*. They are kept only if within 72 h before, or 1 h after, submission.
   - **Visit type:** a short answer to a *type / visit / reason* question, such as "Lock up", "Unlock", "Call out" or "Patrol".
   - **The moment used for matching:** arrival, else when the form was opened on the phone, else submission.
2. **Site** (`pickSite`). It searches the form's client's active sites, or **all clients'** if the form isn't tied to one. If the typed site names exactly one client ("Shurgard self storage Woolwich"), only that client's sites are searched and its name is dropped from the text (`narrowSiteText`). "Self" and "storage" are always dropped, since every storage site shares them; without this, every "Access Self Storage …" outscored "Woolwich (SH-74)". Then:
   - **Postcode first.** Several sites with that postcode are told apart by the name, then by GPS within 2 km.
   - **Then the name**, using the Telegram bot's fuzzy match. Among several hits, a site with every word in its **name** beats one with them only in its address (a site on "Woolwich Road"), then GPS within 2 km settles it. Numbers and filler like "site" never find a site on their own and must match whole words, so a misspelt place ("Dratford site 1") is left for GPS or a person, not linked to a stranger.
   - **Then GPS alone**, within 500 m.
   - **Still not settled — by the work on there** (`pickSiteByActivity`). This applies when the postcode or name fits several sites, or none fits but the phone was within 2 km of some. If exactly one of those sites had work on at the time (a static shift on, or a job or visit within 3 hours), that's the site. It isn't used when that site is more than 5 km from the phone's GPS fix.
3. **What it's about.** The kind is the visit type from the form, else the form's *Reports* setting.
   - **Patrol report while a static or dog-handler shift is on at that site** (30 min before the start to 60 min after the end): it is attached to the shift (`pickShift`). If two shifts were on, the officer named in the form decides, else the one that started first. A shift takes any number of reports, and attaching one bills nothing.
   - **Otherwise:**
     - jobs and patrol visits at the site with any time within **3 hours** are considered. Cancelled jobs, partner-handled jobs and shift jobs are left out.
     - The nearest wins, and an activity of the report's own kind counts as 30 min closer.
     - If the runner-up is within 20 min of the winner, it's a close call. It still decides — the report's own kind of work first, then the nearer time, then the earlier activity — and the note says so.
     - Activities that already have a FastField report are **taken**.
   - **Nothing within 3 hours, and no static shift on** (`pickActivityWide`): it looks again up to **18 hours** either side, for a report filed late or a job logged at the wrong time. Only:
     - the **same kind of work** (`familyOf`): patrol or VPI, callout (alarm, ad-hoc, key collection or drop-off, survey), lock-up, unlock;
     - activities **without** a FastField report;
     - activities **already due** when the import runs, so an afternoon report never completes tonight's patrol or lock-up early.

     The nearest still wins; a close call is settled as above. The note says it came from the 18-hour look, with how far apart the two were.
4. **Outcome:**
   - A pick → **LINKED**.
   - No job or visit to attach it to:
     - **a static shift was on** → **LINKED to the shift**, whatever the report's kind. The guard on duty dealt with it, so no job is made and nothing is billed twice;
     - **a patrol report** filed up to **6 hours after** a shift at the site ended, or up to **2 hours before** one started (rounds sent in late) → **LINKED to that shift** (`shiftAround`, the nearest);
     - otherwise, if nothing was near the time and the site belongs to the form's *Make the job* client (Shurgard) → **CREATED**: a completed job of the report's kind;
     - otherwise → **UNMATCHED**.
   - An UNMATCHED report's note says why: site not recognised, nothing near the time, or the activity already has a report. (*Ambiguous* and *shift* no longer happen for new reports. Older ones may still carry them.)

### Attaching (`linkReportToJob` / `linkReportToVisit` / `linkReportToShift` / `createJobForReport`)

Each runs in one transaction. It creates the `FormSubmission` (officer name from the form, matched officer as `submittedByUserId`, arrival and departure) and the `ReportReview` set to **APPROVED** ("Imported from FastField."). It then updates the activity and the report's status and links. The finance snapshot runs afterwards.

- **Job:**
  - unfinished statuses become `APPROVED`;
  - fills `startedAt` (arrival, which feeds the alarm SLA), `completedAt` (departure, else submission) and GPS;
  - if nobody is assigned and it isn't partner work, assigns the matched officer;
  - then `snapshotJobFinanceIfNeeded`.
- **Patrol visit:**
  - becomes `COMPLETED`;
  - keeps any existing arrival and departure and fills the rest, plus GPS;
  - adds the photos if it has none, and the officer if it has none;
  - billing and pay at the PATROL rate where still empty, dated to the scheduled night.
- **Shift:** the shift is left as it is; its own check-ins, times and pay stand.
- **Created job:**
  - type from the report's kind (`ALARM_RESPONSE` → source `ALARM`, else `CUSTOMER_REQUEST`);
  - status `APPROVED`;
  - the site's customer and partner;
  - `INTERNAL_OFFICER` plus the matched officer;
  - arrival and departure times;
  - note "Recorded from the FastField report …".

  It shows in the Shurgard daily report like any completed callout or lock-up.

Imports create no `ClientReport`, no customer SMS ack and no visit-completed notification. The client already had FastField's own report, and imports can be weeks old.

### Trying waiting reports again

A report often arrives before its work is in the app — a static shift logged the next morning, a lock-up recorded late. It waits ("No activity…") until it's tried again.

- **Every 5 minutes**, the `fastfield-recheck` cron (Vercel, database only) runs `retryUnmatched`. The robot's `retry` step does the same after each import.
- It takes waiting reports from the last 30 days on forms that are On, best first (`dueForRecheck`):
  1. reports whose site has had a job, shift or visit added or changed within 36 hours of their time, since they were last tried — newest report first;
  2. all of them, once any site has been added or changed since they were last tried (it may be the report's real site) — or the matching rules (`RULES_CHANGED_AT`, moved forward with any change to how reports are matched);
  3. any not tried for a day, longest-waiting first, so new rules reach every report.
- It works one report at a time (two reports must not grab the same job at once) until its time budget (45 s) is spent, and stamps each report it tries (`checkedAt`), so the next run carries on rather than retrying the same ones. Admin → FastField shows "Last tried …" on each waiting report.
- **Try matching again** (admin) does the same for the last 60 days, then the rest longest-untried first, for up to 50 seconds; pressing again carries on.
- Until 23 October 2026 the retry always took the **oldest** 50 waiting reports — mostly ones that can never match — so newer reports were never tried again once their shift was logged.

## Business rules & invariants

- **Nothing is imported until a form is On.**
  - A form seen for the first time is `OFF`, with a starting guess at its settings taken from its name:
    - "Shurgard" → Shurgard only, makes the job;
    - "patrol" → patrols, any client;
    - "alarm" / "call out" → callouts, any client, makes the job at Shurgard sites.
  - The migration set the three forms above to **Preview only**, so the first preview shows what they would do.
  - Switching a form to **On** at `/admin/fastfield` is what starts the import.
- **Jobs are only made at the client the form names** under *Make the job* (Shurgard), never for other clients and never while a static shift is on.
- **One report per job or visit, by the robot.**
  - A taken job or visit is never auto-linked again.
  - A job is only created when *no* job or visit is near the time (nor a similar one free within 18 hours), so two reports of one callout never create two jobs. The second waits as "already has a report".
  - By hand, an admin may link a second report to the same activity.
  - Shifts take any number of reports.
- **Idempotent.** `submissionId` is unique, and the plan skips imported ids. If an overlapping run inserts the same report, the insert hits P2002 and is counted as already imported.
- **Never overwrite.** Attaching only fills empty job or visit times, GPS, officer and finance. It never changes a finished status (`SENT_TO_CLIENT`, `CLOSED`, …), and it never changes shifts.
- **Privacy.**
  - The robot logs counts only, with forms by number, and saves no capture files; the repo's Actions logs are visible to anyone with access.
  - Server-side import errors log an error code, never the message.
  - Photos are public Blob URLs with a random suffix, stored under `uploads/` with the same **180-day** retention as officers' own photos. The originals stay in FastField.

## Entry points

| Entry | Who | What |
|---|---|---|
| `POST /api/imports/fastfield` | the robot (bearer) | `plan`, `import`, `retry`; `?preview=1`; `run` id for preview counts |
| `POST /api/imports/fastfield/photo?submission=&name=` | the robot (bearer) | one JPEG/PNG/WebP ≤ 4 MB → `{ url }` |
| `/admin/fastfield` | admin | form settings with the last preview, "Needs linking" (with when each was last tried), "Try matching again", recently attached |
| `GET /api/cron/fastfield-recheck` | Vercel cron, every 5 min | tries waiting reports again, those with new work at their site first |
| `/admin/fastfield/[id]` | admin | one report: answers, photos, how it matched. Pick a site (grouped by client) and link to a shift, job or visit (those within 3 hours, or within 18 hours when none are that close); create the job; or set the report aside. |
| `/admin/reports/[id]` | admin, dispatcher | a FastField-sourced submission shows the FastField answers |
| `/shifts/[id]` | admin, dispatcher | "FastField patrol reports" lists the rounds filed during the shift |

## Extension points & gotchas

- **Portal changes.** The robot relies on FastField's internal portal commands, not a public API. If FastField changes them, run **FastField discovery** (manual, values masked) and compare. The *Recent Submissions* card must stay on the robot login's dashboard.
- **Volume.** About 80 submissions a day across 12 forms (mid-October 2026), most of them Site Patrol rounds. If a preview shows many patrol reports as "nothing near the time", the static shifts for those sites probably aren't in the app for those dates.
- **Postcodes** are matched exactly against `Site.postcode` after removing spaces and capitalising. A postcode that isn't one of ours falls back to name matching.
- **Three-state answers** are shown as 0 = No, 1 = Yes, 2 = N/A, like the app's own tri fields.
- **Repeating sections** in a form are kept as raw values. Their photos are still copied and listed under "Other photos".
- **A different login.** The robot needs a single-account FastField login without 2-step verification. The `FASTFIELD_ORG_ID` secret is only used by the discovery robot.
