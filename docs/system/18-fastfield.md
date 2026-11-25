# 18 — FastField reports

## Purpose & scope

Our officers file their own reports on **FastField**, not on `/submit`: callouts, lock-ups / unlocks, mobile patrols and the patrol rounds of static shifts. This imports those reports and **attaches each one to what it's about**: the static shift, callout job, patrol visit or lock/unlock. The activity then shows the officer's report, photos and times. Jobs and visits are also marked done and are billed and paid as if the officer had used `/submit` (a VPI schedule's visit at the VPI rate, any other visit at the patrol rate).

FastField offers no webhook on our plan. A **browser robot** reads the FastField web portal every 4 hours (GitHub Actions), the same way the Nexus and Keyholding syncs work. In the app, a cron every 5 minutes checks the robot's own shift links and tries waiting reports again.

The forms in use (from the office):

| Form | Used for | Starting settings |
|---|---|---|
| Shurgard-titled form ("Shurgard callouts and lock ups / unlock report") | Shurgard callouts, lock-ups, unlocks | Shurgard sites only; creates the job at Shurgard sites |
| **Site Patrol Form** (FastField form 549243) | Static-shift patrol rounds at Shurgard sites, and patrols for other clients (e.g. Reay Security) | Any client; patrols / static shifts; never creates |
| **Alarm Response Form** | Alarm callouts for Shurgard and other clients | Any client; callouts; creates the callout only at Shurgard sites |

- **In scope:**
  - reading FastField submissions and copying photos and signatures;
  - matching each report to a site and an activity, by the times typed in it;
  - creating the job where the form says to;
  - the robot's 5-minute shift check, and putting back reports it took off;
  - the `/admin/fastfield` pages: form settings and previews, linking and unlinking by hand, skipped places, set-aside reports;
  - the Claude connector's read-only review (`review_fastfield`).
- **Out of scope:**
  - sending anything to FastField (the robot is read-only);
  - the reports FastField itself emails to clients (unchanged);
  - editing a report after import (FastField stays the original).

## Data model

Migrations:
- `20261018120000_fastfield_import`: the two tables.
- `20261018150000_fastfield_shifts_modes`: form modes, the create-for client, shift links and the presets above.
- `20261023150000_fastfield_checked_at`: `checkedAt`.
- `20261117120000_fastfield_skip`: the `FastFieldSkip` table and `skipId`.
- `20261124120000_fastfield_unlink`: `unlinkedAt`.
- `20261124140000_fastfield_shift_check`: `shiftCheckedAt`.
- `20261124160000_fastfield_linked_by_hand`: `linkedByHand`, set on the reports then LINKED whose note read "Linked by …".
- `20261125012000_fastfield_review_fixes`: `linkedAt`, `unlinkedBy` (enum `FastFieldUnlinkBy`), `rulesVersion`, and the `RunLock` table. It filled in `linkedAt` from each attached report's review time, and `unlinkedBy` as `PERSON` unless the robot's shift-history line (or its note) said the robot took the report off.

| Model | What it is |
|---|---|
| `FastFieldForm` | One FastField form, keyed by FastField's own `formId`. See the field list below. |
| `FastFieldReport` | One imported submission, keyed by FastField's `submissionId`, which is unique, so re-imports are no-ops. See the field list below. |
| `FastFieldSkip` | A skipped place (see **Skipping a place**). |
| `RunLock` | A lease lock, so only one copy of a background run works at a time. The FastField matcher uses the row `fastfield-matcher` (see **One matcher at a time**). |

`FastFieldForm` fields:
- `mode`: `OFF`, `PREVIEW` (read only by preview runs, never imported) or `ON`.
- `jobType`: what the form reports. It is preferred when matching and is the job made when nothing matches.
- `customerId?`: match only this client's sites. Null means any client, and the site in each report decides.
- `createCustomerId?`: when a report matches nothing at **this** client's site, create the job. Null means never.
- `previewCounts`, `previewAt`, `previewRun`: what the last preview said this form's reports would do.
- `lastSeenAt`.

`FastFieldReport` fields:
- What was sent:
  - `answers Json`: the answers in form order, `[{ key, label, type, value, at?, lat?, lng? }]`, with photos already replaced by our URLs. `at` is when the field was tapped on the phone; it is never read as a time.
  - `photoUrls`, `signatureUrl`.
  - `siteText`, `officerText`: the site and officer as typed; `submittedBy`: the FastField user.
  - GPS (`lat`, `lng`); `submittedAt`, the send time; `startedAt` / `finishedAt`, the phone's opened / finished times — never used for anything (the robot no longer sends them; older rows may still hold them).
- The outcome:
  - `status`: `LINKED`, `CREATED`, `UNMATCHED` (waiting in Needs linking) or `IGNORED` (set aside);
  - `note`: how it was matched, or why not;
  - links: `siteId?`, then `jobId?`, `patrolVisitId?` or `shiftId?`; `formSubmissionId?` (unique: the round it added) and `jobCreated`;
  - `skipId?`: the **`FastFieldSkip`** (skipped place) that set it aside, if one did.
- How it got there:
  - `linkedAt`: when it was last attached (linked, or its job made). A move by the robot's shift check keeps it; taking the report off clears it.
  - `linkedByHand`: a person linked it, to any activity. The robot never moves or takes off such a report.
  - `unlinkedAt` and `unlinkedBy` (`ROBOT` | `PERSON`): when, and by whom, it was last taken off its activity. Who took it off decides what happens next (see **Rules at a glance**).
- The robot's bookkeeping:
  - `checkedAt`: when the robot last judged it while it waited (a retry, a put-back look, a failed try, a take-off). Empty means due soon.
  - `shiftCheckedAt`: when the shift check last found it fits its shift (or kept it). It's checked again once the shift changes after this.
  - `rulesVersion`: the `FASTFIELD_RULES_VERSION` (`src/lib/fastfieldRulesVersion.ts`) it was last judged under; rows from before 25 Nov 2026 started at 0. Lower than the current version means the robot judges it again, once.

`FastFieldSkip` fields: `siteKey` (unique: the typed site cut down to lowercase letters and digits), `label` (the spelling typed most often), `createdBy`, `createdAt`, and its `reports`.

`RunLock` fields: `name` (the key), `lockedUntil` (the lease), `holder` (a random id per run) and `updatedAt`, which has no database default, so raw-SQL inserts set it.

A linked report also gets a normal **`FormSubmission`** with a `ReportReview` set to `APPROVED`:
- **On a job or visit**, the submission's form matches the activity (a VPI schedule's visit gets a `VPI` one).
- **On a shift**, the form is `PATROL` with `shiftId` set. It is not `SHIFT_CHECK`, so the duty-link check-in record and the shift report's check-in counts are untouched.

Everything that lists submissions sees it: the job, visit and shift pages, the review queue, the site history and the client portal.

Its `payload` is `{ source: "fastfield", fastfield: { submissionId, formId, formName }, photoUrls, signatureUrl? }`. The answers themselves live on the `FastFieldReport`, and the review page reads them through `FormSubmission.fastfieldReport`. The Shurgard daily report's static-guarding section picks up `photoUrls` of shift-linked submissions, so patrol-round photos appear there, capped at 8 per shift like check-in photos.

### History (ActivityLog)

Every change to where a report sits leaves a line. It holds ids, times, yes/no flags and short labels only — never answers, client details or money. `userId` is the person who did it; no user means the robot.

| Action | On | Written when | `diff` |
|---|---|---|---|
| `fastfield_linked` | the `Job`, `PatrolVisit` or `Shift` | a report is linked, by the robot or a person | `{ fastfieldReportId, byHand, prev }`: `prev` is exactly what the link changed (see **Attaching**), `{}` for a shift |
| `fastfield_created` | the `Job` | a job is made from a report | the same |
| `fastfield_put_back` | the `Shift` | the robot puts a report it took off back on a shift | the same, with `byHand: false` |
| `fastfield_unlinked` | the `Shift` | the shift check takes a report off (`by: "robot"`), or a person unlinks it | `{ fastfieldReportId, by? }` |
| `fastfield_unlinked` | the `Job` or `PatrolVisit` | a person unlinks a report | `{ fastfieldReportId, by: "person", undone, sentToClient? }` |
| `fastfield_moved_off` / `fastfield_moved_on` | the two `Shift`s | the shift check moves a report | `{ fastfieldReportId, toShiftId }` / `{ fastfieldReportId, fromShiftId }` |
| `fastfield_released` | the `FastFieldReport` | it came off because its activity was deleted | `{ reason, shiftId? }`, reason `shift_deleted`, `shift_cancelled_by_partner`, `data_reset` or `activity_deleted` |
| `fastfield_set_aside` / `fastfield_brought_back` | the `FastFieldReport` | Set aside / Bring back on one report | — |
| `fastfield_skip_place` / `fastfield_stop_skipping` | the `FastFieldSkip` | Skip / Stop skipping | `{ label, setAside }` / `{ label, broughtBack, robotTries, robotPutsBack, waitForYou }` |
| `fastfield_first_check_reviewed` | the `FastFieldReport` | Put back / Leave it on the 24 Nov list | `{ decision: "put_back", shiftId }` or `{ decision: "left" }` |
| `import on` / `preview only` / `import off` | the `FastFieldForm` | a form's Import setting changes | — |

The 24 Nov list's **Put back** also writes `fastfield_linked` on the shift (`byHand: true, firstCheck: true`) and, when it moves a report off another shift, `fastfield_unlinked` there. `/shifts/[id]` shows its shift's lines in plain words ("FastField report linked by hand", "FastField report taken off by the robot: it didn't fit the shift's time", …); the robot's lines are signed "FastField robot".

## Key files

| File | Role |
|---|---|
| `scripts/fastfield-forms.mjs` | The robot: login, list, plan, read each submission, copy media, send, hand back refused reports, retry. Counts-only logs, with per-form lines keyed by form number; of the app's errors, only their codes. |
| `.github/workflows/partner-syncs.yml` (step 4) | The 4-hourly run: last 3 days, 8-minute limit. |
| `.github/workflows/fastfield-forms.yml` | Manual run with From/To dates, Preview on by default, and a 110-minute limit. Used for previews and the backfill. |
| `src/app/api/imports/fastfield/route.ts` | Actions `plan`, `import`, `refused` and `retry`, with `?preview=1` and a `run` id. Bearer `NEXUS_IMPORT_SECRET`, fail-closed. |
| `src/app/api/imports/fastfield/photo/route.ts` | Takes one photo per request, checks it really is a JPEG, PNG or WebP, and stores it in Vercel Blob under `uploads/fastfield/<submission>/…` with a random suffix. |
| `src/app/api/cron/fastfield-recheck/route.ts` | The 5-minute cron: the shift check, then the retry. |
| `src/lib/fastfield.ts` | Pure functions: facts from the answers (site, postcode, officer, typed times, GPS, visit type), the report's time (`reportSpan`), and the site, officer, shift and activity choice (`pickSite`, `matchOfficer`, `shiftFit`, `pickShift`, `shiftLinkAction`, `pickActivity`). Tests: `fastfield.test.ts`. |
| `src/lib/fastfieldImport.ts` | Database side: forms, plan, import, preview counts, the retry, the attach and unlink functions, the shift check and put-back, releases, skipped places, the hand-link list and the connector's review. |
| `src/lib/fastfieldAttach.ts` | Pure: what a link changes on a job or visit (`planJobLink`, `planVisitLink`, the `prev` record) and what Unlink puts back (`planUnlinkUndo`, `planCreatedJobUndo`). |
| `src/lib/fastfieldSentToClient.ts` | `sentToClient`: whether an attached report has already gone to the client. |
| `src/lib/fastfieldRulesVersion.ts` | `FASTFIELD_RULES_VERSION`: bump it with any rule change. |
| `src/lib/runLock.ts` | The lease lock on `RunLock` (`withRunLock`). |
| `src/lib/fastfieldIntake.ts` | Checks at the door: photo addresses (`keepOurMedia`), safe links (`safeLinkUrl`), real image types (`imageTypeOf`), error codes. |
| `src/lib/fastfieldRefused.ts` | Keeps the reports the import refused, set aside with the reason. |
| `src/lib/fastfieldHandLink.ts` | Pure parts of linking by hand: the list's window, the markers, the confirmation and toast texts, the site picker's groups. |
| `src/lib/fastfieldAdminList.ts` | Pure parts of the list page: places from database counts, Stop-skipping notes, the taken-off line, the Try-matching-again message, jobs made by hand. |
| `src/lib/fastfieldFirstCheck.ts` | The 24 Nov first-check list, with Put back and Leave it. |
| `src/app/(app)/admin/fastfield/*` | The list page (`page.tsx`), one report (`[id]/page.tsx`), the actions (`_actions.ts`, `_firstCheckActions.ts`) and their buttons and dialogs (`_components/`). |
| `src/components/FastFieldAnswers.tsx` | Renders a report's answers (photos, signature, GPS), putting only http(s) addresses in links and images. Used on `/admin/fastfield/[id]`, `/admin/reports/[id]` and the client portal. |
| `src/lib/mcp/tools/fastfield.ts` | The connector's `review_fastfield` (see [`17-claude-connector.md`](./17-claude-connector.md)). |
| `scripts/fastfield-discovery.mjs` + `fastfield-discovery.yml` | The manual, value-masked portal explorer used to build the robot. Keep it for debugging portal changes. |

## Core flows

### The robot (every 4 hours, and by hand)

1. Log into `portal.fastfieldforms.com` (`#email` / `#pwd`). It stops with a clear message on a 2-step code, a new-location check or a multi-account login.
2. Call `Dashboard.GetDashboards` to get the dashboard's *Recent Submissions* card and `allForms` (form ids and names).
3. Call `Dashboard.GetCardData` for that card with `selectedUser: "All Users"` and the date window, 200 per page, to get every submission id and form name. If the login may not list all users, it falls back to the dashboard's own user filter.
4. `POST /api/imports/fastfield { action: "plan" }`. The app records the forms and returns the ids that are **new** and on a form that is **On**, or also **Preview only** in a preview run. A preview also clears the forms' last-preview counts under the run's id.
5. For each new id, three at a time:
   - `Submission.GetSubmissionData` gives the answers in form order (values from `submission`, labels and types from `form`, capture times and GPS from `formMetaData.fieldMetaData`). The send time is the submission's `updatedAt` (else the time the robot read it). The phone's opened and finished times in `formMetaData` aren't sent: they're never used.
   - Photos and the signature (`media` list, up to 60 a report) are fetched via `/api/media/amazon/<key>/redirect` and shrunk in the browser to a JPEG of at most 1600 px. Standard JPEG, PNG or WebP files of 1.2 MB or less are kept as they are.
   - Each one is uploaded to `./photo`, which stores it only if its first bytes say it's a JPEG, PNG or WebP (else `415 not_an_image`) and it's 4 MB or less. A preview copies nothing.
6. `POST { action: "import", run, reports }`, three at a time. If the app refuses a batch, the reports go one by one so a single odd report can't block the rest. The import keeps only photo and signature addresses that are https, on Vercel Blob's public storage, under `uploads/fastfield/` (where the photo route puts them), and leaves out any other; the robot's summary counts them ("… left out (not on our storage)").
7. **Refused reports.** A report the app refuses for what it holds — too big (413), or something in it the app can't read (400 `invalid_report`) — is handed back at the end of the run (`action: "refused"`: its id, form, send time, FastField user and the reason; never its answers). The app keeps it set aside (`IGNORED`) with no answers or photos and the note "Couldn't import this report from FastField: it was too big / part of it couldn't be read. Open it in FastField to read it. The robot won't try it again." `plan` then counts it as imported, so later runs don't copy its photos again. This only happens in a run where the app took other reports: if it took none, the fault may be on the app's side, and the next run tries them all again. A preview keeps nothing. To import such a report after a fix, delete its row and run the robot over its date.
8. `POST { action: "retry" }`, real runs only. This tries waiting reports again (see **Trying waiting reports again**), in case a shift or job has been logged since. If the app is already matching (see **One matcher at a time**), it skips this and the log says so.

It stops starting new reports at the time limit, and the next run carries on.

### A report's time (typed times only)

Where a report goes is decided only by the times **typed** in it. When a field was tapped on the phone (an answer's `at`), and when or how long the form was open (`startedAt` / `finishedAt`), never decide it.

- **Its moment** (`when`): the typed arrival, else the typed departure. With no usable typed time it has none. Jobs and visits are matched around it, a site is settled by the work on there at that time, and the hand-link list and the connector's review centre on it.
- **Its span** (`reportSpan`): from the typed arrival to the typed departure. One typed time on its own is that moment; with no usable typed time at all there is no span, and the report waits for a person ("No time was typed on the form, so the robot can't tell which shift or job … it belongs to — link it by hand.", wait reason `time`). Shift fit is judged on it everywhere: the robot's matching, the shift check, put-back, the outside-its-time list and the pages.

How the typed answers are read (`typedValue`, `timeRole`, `extractFacts`):
- **Formats.** A typed date and time is read in any of the forms FastField may send: ISO (`2026-11-24T22:15:00.000Z`, with or without a zone, a `T` or a space, `2026/11/24 22:15`), a numeric date **day first or month first** (`24/11/2026 22:15`, `11/24/2026 10:15 PM` — FastField is an American app), a month name (`24 Nov 2026 22:15`, `Nov 24, 2026 10:15 PM`, `Tuesday, 24 November 2026`), a JavaScript date string, milliseconds or seconds since 1970 (a number, text, or .NET's `/Date(…)/`), or an object holding it (`{ dateTime }`, `{ value }`, `{ date, time }`). A numeric date that reads both ways (`11/02/2026`: 11 Feb or 2 Nov) is the reading that fits when the report was sent (72 h before to 15 min after); if neither or both fit it isn't used. On the report pages such a date is settled the same way, and shown as typed when it can't be. Until 25 Nov 2026 a value that couldn't be read silently fell back to when the field was tapped (a phone time); now it simply isn't read, which is how US-style dates came to light (rules version 3).
- **Date and time answers.** A full date and time is that moment; without a zone it's UK time. A time on its own ("06:20", or a time on FastField's 1900 placeholder date) is a time of day: it goes on the form's own date (the first date answer labelled *date*, else the first date answer), else on the UK day the report was sent — the day before, when that would be more than 15 minutes after it was sent. A date on its own ("2026-11-24", or midnight under a label that asks for a date) only supplies the date.
- **Whose time it is**, by the label:
  - arrival words: *arrive, attend, on site, reached, start, commenced, time in / on, check in, signed / booked / clocked / logged on or in, on duty*;
  - departure words: *depart, leave / left, off, finish, end, complete, time out, check out, signed / booked / clocked / logged off or out, exit*;
  - both or neither: a plain visit time ("Date/Time of patrol", "Start/Finish").
  - **Never the officer's:** someone else's time — police, ambulance or paramedics, a keyholder, engineer, technician, contractor or manager, the fire services, the emergency services, or a client or customer as a person ("Customer arrived"; "Arrival at customer site" is the officer's) — or an event's: *activation, triggered, alert, reported, received*, "Time of callout", "Callout time".
  - Under an **alarm, an incident or a phone call** ("Alarm time", "Incident start time", "Time called") a time counts only with words that mean the officer was there: "Arrived at alarm" and "Time attended incident" count, "Time alarm turned off" doesn't. A callout, response or attendance is the officer's own job: "Callout start time" is an arrival and "Alarm callout finish time" a departure.
- **When they count:** typed times from 72 hours before the send time (reports are often filled in offline and sent later) to 15 minutes after it. Others are on the wrong day and are left out.
- **Putting them together:** a labelled arrival (the earliest) and departure (the latest) win; plain times fill a missing side, the earliest for the arrival and the latest for the departure. One plain time on its own is the report's moment. A departure typed as a time only that comes before the arrival is on the next day (a round over midnight).
- **Times that can't be right:** a dated departure before the arrival, or an arrival and departure more than 24 hours apart, are both dropped. The report then has no usable time, and its note says why ("Its typed times are more than a day apart, so the robot can't use them.").
- FastField's own timestamps (the send time, opened, finished) are read as they arrive: with their zone if they carry one, else as UTC. Whether they carry one hasn't been checked.
- The phone's opened / finished times are never used: not to decide where a report goes, not written on the activity, not as a fallback for anything. Neither is the send time, except to say which typed times are believable (above) and which day a time typed without a date is on.

Until 24 Nov 2026 the phone's times were the fallback for shifts, and until 25 Nov jobs and visits were matched around the phone's opened time; the owner had them dropped. Later on 25 Nov the owner had every other stand-in dropped too (rules version 2): no send time when nothing usable is typed, and no phone times on the activity.

### Matching one report (`importFastField` → `decide`)

The reports in one call are judged oldest first, so an earlier report claims an activity before a later one. A preview writes nothing; within a preview run, an activity an earlier report would take counts as taken, and a job it would make counts as made.

1. **Facts** (`extractFacts`):
   - **Site:** the first text answer whose label names the site — *Site / Premises / Property / Store / Branch / Building / Address / Depot / Facility / Location* ("Site Name", "Site Attended", "Patrol Location", "Customer site") — and whose answer isn't a yes / no. Not a label that asks about something else: the phone's position (GPS, map, co-ordinates), someone else's details (stuck, witness, keyholder, police, caller, home, your, contact, manager), notes, checks and codes about the site ("Site notes", "Building secure?", "Alarm location", access, keys, photos, type, reason), being on or off it ("Staff on site?", "Time left site"), the officer ("Site attended by"), or a customer's or client's own details unless it's their site.
   - **Postcode:** a UK postcode typed in that site answer, else in a *Postcode* or *site / premises … address* answer that isn't someone else's (stuck, witness, keyholder, police, caller, home, your, contact, manager, officer, guard, staff) or a customer's. "Unit B2 3rd floor" isn't a postcode.
   - **Officer:** an *Officer / Guard / Operative / Responder / Patroller / SIA* answer; else *Attended by*, *Staff name* or *Staff*; else a bare *… Name* that isn't the site. Never a customer's, company's, police, witness or keyholder answer, a note, check, signature or photo about the officer, a yes / no, or anything over 80 characters. A 16-digit SIA number is split off.
   - **Arrival and departure:** the typed times (see **A report's time**).
   - **Visit type:** a short answer (40 characters or less) to a *type / visit / reason / service / activity / job / callout* question — not a property, premises, building, unit, vehicle or alarm type, nor a number, reference or code — read by whole words: "Lock up", "Unlock", "Patrol", "Call out" / "Alarm" / "Response", "Key collection". "LOCK-221" and "Property type: Lock-up unit" say nothing.
2. **Site** (`pickSite`). It searches the form's client's active sites, or **all clients'** if the form isn't tied to one. If the typed site names exactly one client ("Shurgard self storage Woolwich"), only that client's sites are searched and its name is dropped from the text (`narrowSiteText`). "Self" and "storage" are always dropped, since every storage site shares them; without this, every "Access Self Storage …" outscored "Woolwich (SH-74)". Then:
   - **Postcode first**, when it's one of our sites' postcodes. **If the name points to one site and the postcode to another**, one of them is wrong: only a clear GPS fix settles it (within 2 km, with every other site at least twice as far), otherwise the report waits for a person ("The site name and the postcode point to different sites … — pick the right one.") — and the work on there doesn't settle that either. Otherwise one site with that postcode is the site, and several are told apart by the name, then by GPS within 2 km.
   - **Then the name**, using the Telegram bot's fuzzy match. Among several hits, the sites with every word in their **name** are the real candidates (a site on "Woolwich Road" counts only when none has the words in its name), and GPS within 2 km settles it among those. Numbers and filler like "site" or "end" never find a site on their own and must match whole words, so a misspelt place ("Dratford site 1") is left for GPS or a person, not linked to a stranger.
   - **Then GPS alone**, within 500 m.
   - **Still not settled — by the work on there** (`pickSiteByActivity`). This applies when the postcode or name fits several sites, or none fits but the phone was within 2 km of some. If exactly one of those sites had work on at the time (a static shift the report fits, or a job or visit within 3 hours), that's the site, unless it's more than 5 km from the phone's GPS fix.
3. **Officer** (`officerFor` → `matchOfficer`), among the admins, dispatchers and officers: by the SIA number first (only when exactly one person has it), then by name, in whole words (`matchOfficerName`). The exact full name counts first; otherwise every typed word must be one of the person's names, so "Ali" is Ali Example or Jo Ali but never Natalie Sample, and "Sam Test" isn't Sam Other. A single letter is an initial, and only next to a name ("A. Test" is Ana Test when she's the only one it fits); initials alone fit nobody; titles and the job ("Mr", "Officer", "Security") are ignored. Active staff come first: a name that several of them fit names **nobody**, and is never passed on to staff who have left; only when no active member of staff fits does it look at those who have left. The officer helps choose between shifts (below) and goes on a job or visit that has nobody.
4. **What it's about.** The kind is the visit type from the form, else the form's *Reports* setting.
   - **The shifts the robot considers** (`shiftsNear`): our own static and dog-handler shifts at that site that started (scheduled or actual) from 36 hours before the report's start to 30 minutes after it — the 50 that started latest.
     - **Never a partner's shift:** their officers report in their own app, as with partners' jobs and visits, so a round of ours that fits only a partner's shift belongs to our own work there.
     - **Missed and abandoned shifts are kept, on purpose:** a shift is marked missed when nobody started its duty link, but the officer may still have worked it — the rounds are the evidence. Left out, a round that fits it would see "no shift on" and could complete a nearby visit or, on a make-the-job form, create and bill a callout. A shift link bills nothing.
   - **Fits** (`shiftFit`): the report's span starts no more than **30 minutes** before the shift starts and finishes no more than 30 minutes after it ends (`SHIFT_GRACE_MIN`). The shift's window is the earliest of its scheduled and actual start to the latest of its scheduled and actual end. It's judged to the millisecond; the minutes a report is out by are rounded up, so 30 min 20 s over reads "31 min".
   - **Which shift, when it fits several** (`pickShift`): the one it's strictly inside (no allowance used); then the one worked by the officer named in the form; then the one it runs least past (minutes before the start and after the end added up); then the one the rota has it in (from its scheduled start up to, not at, its scheduled end, so a round at 19:00 is on the shift starting at 19:00); then the one scheduled to start first.
   - **A patrol report that fits a shift** goes on the shift. A shift takes any number of reports, one per round, and attaching one bills nothing.
   - **Otherwise, jobs and patrol visits** at the site with any time within **3 hours**: the nearest 50 of each. Cancelled ones, partner-handled ones, jobs tied to a patrol visit (the visit itself is the candidate) and jobs that stand for a shift are left out.
     - The nearest wins, and an activity of the report's own kind counts as 30 min closer.
     - If the runner-up is within 20 min of the winner, it's a close call. It still decides — the report's own kind of work first, then the nearer time, then the earlier activity — and the note says so.
     - **One report per activity.** Activities that already have a FastField report are ranked the same way. When the best match already has one, the new report is most likely a second report for it, so it **waits** ("It looks like the callout at 22:15 at …, which already has a report — link it by hand if it's a second report for it.") rather than go on the next activity along, a static shift or a new job. A free activity still wins when it is the better match.
   - **Nothing within 3 hours, and no shift it fits** (`pickActivityWide`): it looks again up to **18 hours** either side, for a report filed late or a job logged at the wrong time. Only:
     - the **same kind of work** (`familyOf`): patrol or VPI, callout (alarm, ad-hoc, key collection or drop-off, survey), lock-up, unlock;
     - activities **already due** when the import runs, so an afternoon report never completes tonight's patrol or lock-up early.

     The nearest still wins; a close call is settled as above, and the note says it came from the 18-hour look, with how far apart the two were. As within 3 hours, when the best of them already has a report the new one waits. So a second alarm at a make-the-job client's site within 18 hours of a callout that already has a report waits for a person: no job is made for it.
5. **Outcome:**
   - A pick → **LINKED**.
   - No job or visit to attach it to:
     - **it fits a static shift** → **LINKED to the shift**, whatever the report's kind. The guard on duty dealt with it, so no job is made and nothing is billed twice. Not when the best match already has a report: then it waits;
     - otherwise, if nothing was near the time and the site belongs to the form's *Make the job* client (Shurgard) → **CREATED**: a completed job of the report's kind;
     - otherwise → **UNMATCHED**, waiting in Needs linking.
   - An UNMATCHED report's note says why: the site wasn't recognised (or several fit, or the name and postcode disagree), nothing was near the time, or the activity already has a report. Every note also says when the typed times couldn't be used. (*Ambiguous* and *shift* no longer happen for new reports. Older ones may still carry them.)
   - A stored report that then fails to attach (an error, or the activity changed meanwhile) keeps waiting, with a note saying so ("Couldn't attach automatically: …"), and the robot tries it again later.

### Attaching (`linkReportToJob` / `linkReportToVisit` / `linkReportToShift` / `createJobForReport`)

The robot and the people on `/admin/fastfield` use the same four functions. Each runs as **one database transaction** (up to 15 s): all of it happens or none of it does. A refusal, or any error (a billing failure included), rolls the whole link back.

1. **Claim the report** (`claimReport`): a conditional update that also locks the report's row. Only a report with no round on anything can be taken. A person can take one that's waiting or set aside, whatever happened to it before. The robot only takes a waiting one, never one a person took off, and one the robot took off itself only back onto a shift (never a job, visit or new job). A second attach of the same report waits on the lock, then finds it taken and rolls back ("already attached"): one report, one activity, one round, billed once.
2. **Lock the activity** (`SELECT … FOR UPDATE` on the job or visit, `FOR SHARE` on a shift) and read it again, so what's judged is current and nobody changes it meanwhile.
3. **The robot refuses** a cancelled job or visit, one that already has another FastField report or round ("taken"), and a shift the report doesn't fit. A person may pick any of them:
   - **cancelled work:** the report is attached, but the job or visit is left exactly as it is — not reopened, marked done, billed or paid — and the note says so;
   - **a job that stands for a shift** (`STATIC_GUARDING_SHIFT` / `DOG_HANDLER_SHIFT`, only ever linked by hand): the report is attached and the job left as it is. The shift bills itself, so marking the job done would bill it twice.
4. **Create the round:** the `FormSubmission` (officer name from the form, the matched officer as `submittedByUserId`, arrival and departure) and its `ReportReview` set to **APPROVED** ("Imported from FastField.").
5. **Update the activity** (`planJobLink` / `planVisitLink`). It fills only what's empty, and its write only goes through if the status is still the one read under the lock.
   - **Job:**
     - unfinished statuses (`OPEN`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `REVIEW_PENDING`) become `APPROVED`;
     - fills `startedAt` (the typed arrival, which feeds the alarm SLA), `completedAt` (the typed departure) and GPS — times only when typed: one not typed stays empty, and a job isn't billed until it has a finish time;
     - if nobody is assigned and it isn't partner work, assigns the matched officer (and the responder type);
     - then the bill and pay where still empty (`fillJobFinance`).
   - **Patrol visit:**
     - unfinished statuses (`PENDING`, `IN_PROGRESS`, `LATE`, `MISSED`) become `COMPLETED`;
     - keeps any existing arrival and departure and fills the rest (arrival = the report's arrival, else its finish), plus GPS;
     - adds the photos if it has none, and the officer if it has none and isn't a partner's;
     - a **VPI** schedule's visit is billed and paid at the **VPI** rate, any other at the PATROL rate, where still empty (`fillVisitFinance`), dated to the scheduled night.
   - **Shift:** left as it is; its own check-ins, times and pay stand. The report is extra evidence (its photos appear in the client's static-guarding report), nothing is billed, and its `shiftCheckedAt` is stamped.
   - **Created job:**
     - type from the report's kind (`ALARM_RESPONSE` → source `ALARM`, else `CUSTOMER_REQUEST`);
     - status `APPROVED`;
     - the site's customer and partner; only at an active site;
     - `INTERNAL_OFFICER` plus the matched officer;
     - arrival and departure times, GPS, and the note "Recorded from the FastField report …";
     - billed and paid (`fillJobFinance`).

     It shows in the Shurgard daily report like any completed callout or lock-up.
   - The arrival and departure written (on the round and the activity) are the typed ones. Nothing else ever stands in: a time that wasn't typed stays empty on the round and the activity (a person can add it there).
   - Billing and pay run **inside the link's transaction**, so a job or visit is never left done but unbilled.
6. **Stamp the report:** its link, `linkedAt` (now), `linkedByHand`, `rulesVersion`; `unlinkedAt` and `unlinkedBy` cleared.
7. **History:** `fastfield_linked` (or `fastfield_created`, or `fastfield_put_back`) on the activity, with the person (none for the robot) and `prev`: exactly what the link changed. That is the status before and after (when it changed it), each field it filled and the value it put in (start / finish or arrival / departure, location, officer and responder type, photos), whether it filled the bill and the pay, and `cancelled` when it left the activity alone. Unlink reads it back.

Imports create no `ClientReport`, no customer SMS ack and no visit-completed notification. The client already had FastField's own report, and imports can be weeks old.

### A report the robot puts on a shift must fit it

- **The robot** only ever puts a report on a shift it fits (`shiftFit`, above). Its own linking refuses any other (`FF_NO_FIT`), and the shift check and put-back keep to the same rule.
- **A person** can link any report to any shift (`linkReportToShift` with `byHand`): a partner's, a missed one, one the report doesn't fit. Such a report is stamped `linkedByHand`, and the robot leaves it where it was put.
- **History:** the robot used to take reports from 30 min before the start to 60 min after the end, and patrol rounds up to 2 hours before or 6 hours after the nearest shift (`shiftAround`, now gone). The first version of this rule (24 Nov 2026, morning) allowed no leeway at all; rounds a few minutes either side then couldn't be linked, so the 30-minute allowance followed the same day.
- **Seeing it** (`checkReportOnShift`):
  - `/shifts/[id]` lists each report on the shift with its own time, marks those linked by hand and flags any outside the shift;
  - `/admin/fastfield/[id]` says whether the report fits its shift;
  - Admin → FastField lists **On a shift, outside its time**: reports the robot put on a shift (not those linked by hand) in the last 14 days (`OUTSIDE_CHECK_DAYS`) that don't fit it, newest first. It looks at up to 2,000 (`OUTSIDE_SCAN_LIMIT`) and reads just their date and time answers. With the shift check running every 5 minutes, it holds reports between its runs, ones kept because they'd already gone to the client, and any the check couldn't change.

### The robot's shift check (every 5 minutes)

The `fastfield-recheck` cron first runs `checkShiftLinks` (15 s budget), under the matcher's run lock: while another copy of the matcher is running it skips its turn (`busy`).
1. **Reports left on a deleted activity** come off it first (`releaseStranded`, see **When an activity is deleted**), so put-back can try them straight away.
2. **Put-back** of reports the robot took off (`putBackTakenOff`, below), with up to half the budget.
3. **The check.** It takes each report the robot put on a shift (LINKED, not `linkedByHand`) whose `shiftCheckedAt` is empty or older than its shift's `updatedAt` (the shift was edited since), or whose `rulesVersion` is below `FASTFIELD_RULES_VERSION`. It goes newest first, 300 at a time, until the budget runs out, and the next run carries on. A report already looked at in a run isn't looked at again in it, so a batch that failed doesn't hold back older ones.
4. **What it does** (`checkOneShiftLink`, with the unit-tested `shiftLinkAction`):
   - **fits** → stamps `shiftCheckedAt` and the rules version. A report that fits stays, even when another shift would now be the better pick, so reports don't hop between shifts as their times are edited;
   - **doesn't fit, but has already gone to the client** (`sentToClient`) → **kept** where it is and stamped, for a person to sort out (it shows under On a shift, outside its time);
   - **doesn't fit, but fits another shift at the site** (the choice `pickShift` makes) → **moved** there, with its round. It keeps its `linkedAt`, the note says from where and why, and both shifts get a history line (`fastfield_moved_off` / `fastfield_moved_on`);
   - **fits no shift there** → **taken off** (`takeOffShift`, `unlinkedBy` = ROBOT). Its round goes, and it waits in Needs linking with `unlinkedAt` and a note saying why ("…finished 50 min after the shift ended — more than the 30 minutes allowed — and it doesn't fit any other shift there"). The shift's history says the robot took it off. It's never matched to a job or visit, and never makes or bills one; put-back may later put it on a shift it fits.
- **Sent to the client** (`sentToClient`) means its review has client reports, or the daily client email (`ClientReportSend`, status SENT) for a day that covered its activity was sent after the report was attached (`linkedAt`). Patrol visits aren't in the daily email, so only client reports count for them. The client portal, which shows attached reports whenever the client looks, isn't counted.
- **After a rule change** (`FASTFIELD_RULES_VERSION` bumped), every robot link on a shift is judged once more.
- The cron's reply carries `shiftCheck: { checked, fit, moved, takenOff, kept, putBack, released, more, busy? }`.

### Putting back reports the robot took off (`putBackTakenOff`)

It looks at waiting reports with a site that the robot took off (`unlinkedBy` = ROBOT: the shift check took them off, or their activity was deleted):
- once after they came off (`checkedAt` empty), again whenever the rules version goes up, and — for reports sent in the last 30 days — when a shift at their site is added or changed after they were last looked at, if it starts from 108 hours before to 2 hours after the report's send time (36 hours before its earliest possible typed time, to a little after its latest);
- if one now fits a shift there (`pickShift` over the shifts the robot considers), the robot links it there — the same attach, so the fit is checked again — with the note "Put back on the shift … by the robot: it fits with the 30-minute allowance." and one `fastfield_put_back` line on the shift;
- otherwise it's stamped (`checkedAt`, `rulesVersion`) and left until a shift near it changes, or the rules do.

Shifts only: never a job or visit, never a new job. A report a person took off is never put back.

### Unlinking (by a person)

**Unlink** (admin; on the report page, against each report on the shift page, and in the outside-its-time list) runs `unlinkReportFromActivity` after a confirmation. It works for a report on a shift, a job or a patrol visit, and for the job a report made. Each runs as one transaction that first checks the report is still where it was read; if not, nothing changes ("This report changed while you were looking at it…").
- **A shift** (`unlinkReportFromShift`): the round the report added (its `FormSubmission` and approved `ReportReview`) goes. Linking to a shift bills nothing, so there's nothing else to undo. The action writes the shift's history line.
- **A job or a patrol visit:** the round goes, and what the link changed is put back from its `fastfield_linked` record (`planUnlinkUndo`), only where that's safe:
  - nothing is changed when the link left no record (links made before 25 Nov 2026), when it left the activity alone (cancelled, or a shift's job), when the activity is on an invoice, when it has another report (FastField or the officer's own), or when its status was moved on since the link;
  - otherwise each field goes back only if it still holds what the link put in: the status, the start and finish (or arrival and departure), the location, the officer (and responder type), a visit's photos (only if they're still exactly the report's), and the bill and pay if the link filled them.
- **The job it made** (`planCreatedJobUndo`): cancelled, with its bill and pay cleared, as Cancel does — unless it's on an invoice, has another report, or was closed or sent to the client since.
- The report goes back to **UNMATCHED** with a note saying who took it off, `unlinkedAt`, and `unlinkedBy` = PERSON. **The robot never links it again**: the retry, put-back and the connector's dry run all leave it out. A person links it to the right activity or sets it aside.
- A report that has already gone to the client can still be unlinked; the person is told so.
- `check` lists, in plain English, anything it couldn't undo, and whether the report had gone to the client; it stays on screen until dismissed.
- History: `fastfield_unlinked` on the job or visit (`by: "person"`, `undone`, `sentToClient`), or on the shift.

### When an activity is deleted

A report must never be left attached to nothing, out of every list:
- **Deleting a shift** (`deleteShift`, admin or dispatcher) first takes its reports off it, in the same transaction as the delete (`releaseShiftReports`, reason `shift_deleted`).
- **A partner cancelling a shift they recorded** does the same (`shift_cancelled_by_partner`).
- **The Nexus reset of sites** (Admin → Imports → Nexus) takes every attached report off first (`releaseAllAttachedReports`, `data_reset`).
- **Anything else** that deletes an activity under a report: the 5-minute check finds reports still LINKED or CREATED with nothing attached and takes them off (`releaseStranded`, `activity_deleted`, 300 a run).

Each released report's round goes, unless it has client reports, which are kept as the record of what was sent. The report waits again (UNMATCHED) with `unlinkedBy` = ROBOT and `checkedAt` cleared, so put-back looks at it straight away and may put it on another shift at its site that it fits; otherwise it waits for a person. The robot never makes a job for it. A hand link comes off too. After a reset the sites are gone as well, so those reports wait for a person. Each gets a `fastfield_released` line.

### Trying waiting reports again

A report often arrives before its work is in the app — a static shift logged the next morning, a lock-up recorded late. It waits ("No activity…") until it's tried again.

- **Every 5 minutes** the `fastfield-recheck` cron runs `retryUnmatched` after the shift check (30 s budget). The robot's `retry` step does the same after each import (45 s).
- It takes waiting reports from the **last 30 days** on forms that are **On**, never one taken off its activity (`unlinkedAt`): one a person took off waits for a person, and one the robot took off only goes back on a shift, through put-back. Best first (`dueForRecheck`):
  1. reports whose site has had a job or shift added or changed, or a visit added (visits have no `updatedAt`), since they were last tried, with its time within 36 hours of theirs — newest report first;
  2. reports last judged under older rules (`rulesVersion`), and all of them once any site has been added or changed since they were last tried (it may be the report's real site) — newest first;
  3. any not tried for a day, longest-waiting first.

  The report's time in step 1 is when it was received. It only sets the order, never where a report goes.
- It works one report at a time, always at least one, until its time budget is spent. It stamps each report it tries (`checkedAt` and the rules version), including one that fails, so the next run carries on rather than retrying the same ones. A failed try writes its note only while the report still waits as it was: one attached, set aside or taken off meanwhile keeps what it says. Admin → FastField shows "Last tried …" on each waiting report.
- **Try matching again** (admin) does the same for the **last 60 days**, then the rest longest-untried first, for up to **35 seconds**; pressing again carries on. It doesn't re-render the heavy page inside its own request (the button reloads it afterwards), says "The robot is matching right now — try again in a minute." while the run lock is taken, and shows a toast if it fails.
- Until 23 October 2026 the retry always took the **oldest** 50 waiting reports — mostly ones that can never match — so newer reports were never tried again once their shift was logged.

### One matcher at a time (the run lock)

The retry and the shift check (with the stranded release and put-back) share one lock, the `RunLock` row `fastfield-matcher` (`src/lib/runLock.ts`), whoever starts them: the cron, the robot's retry or Try matching again. Only one copy works at a time; another returns at once with `busy: true` and does nothing.
- Taking it is one atomic statement: insert the row, or take it over when its lease has run out.
- The lease is the run's budget plus a minute, by the database's clock, and a run that crashes simply lets it run out. It's a lease rather than a Postgres advisory lock because production reaches the database through a pooler in transaction mode, where an advisory lock doesn't stay with a run.
- Letting go only clears it while the same run still holds it.
- Hand links and creates don't take the lock: the attach's claim keeps a report from going on two activities at once.

### Linking by hand (`/admin/fastfield/[id]`)

The owner's rule: **a person can link any report to any shift, job or visit**. Nothing is hidden; the page says what the robot would make of each one, and what linking it does.
- **Site picker:** every client's active sites, grouped by client: the form's client first, then the client of the site the report was matched to, then the rest A–Z, then sites with no client. Closed sites appear behind **Show closed sites (N)**; the report's matched site is always listed.
- **The list** (`activitiesNearReport`): everything at the chosen site from **3 days** before the report's own time to 3 days after (`HAND_LINK_REACH_DAYS`), or on any UK day picked under **Another day**. A report with no usable typed time has no time to centre on: the list starts on the UK day FastField received it (only where a person starts looking — nothing is decided by it), its rows say there's no typed time to compare, and linking it to a job or visit fills in no times there (the dialog says so). That's shifts (partners', missed and abandoned ones too), jobs and visits, up to 200 of each. The shifts the report fits come first, then the rest, nearest first. Each row shows its time and how it sits beside the report ("the report fits", "outside the shift: the report started 45 min before the shift", "2 h 10 min after the report"), with a marker for anything the robot would skip: *cancelled — linking won't reopen it*, *a partner's job / visit / shift*, *the job of a patrol visit*, *stands for a shift*, *already has a report* (FastField or the officer's own), *marked missed / abandoned*.
- **Link** asks first. The dialog names the activity, its time, the site, the client and the report's own time, repeats the markers, says what linking does (a shift: nothing on it changes and nothing is billed; a job or visit not done yet: marked done, billed and paid; cancelled work or a shift's job: left as it is), and warns when it is a **different client's** activity than the form's or the matched site's ("their portal will show this report"). The toast says what happened. The link is stamped `linkedByHand`, with the note "Linked by <name>."
- **Create job:** a completed job of the chosen kind at the chosen site (active sites only), after a confirmation with the same different-client warning.
- **Set aside / Bring back** (below), and **Unlink** for an attached report (above).

### Skipping a place

Some places will never have work in the app to attach their reports to: a site we don't keep, or one whose shifts aren't recorded. Officers keep filing patrol rounds there, and the reports pile up in Needs linking. **Admin → FastField → Waiting, by place** groups the waiting reports by the site as typed (counted in the database) and offers **Skip** on each place.

- A place is the typed site cut down to lowercase letters and digits (`siteKey`), so "AB1 2CD", "ab12cd" and "AB12CD" are one place. Different words for the same place (a postcode and a building name) are different places, each skipped on its own.
- **Skip** (`skipPlace`) saves a `FastFieldSkip` row (`siteKey`, `label` = the spelling typed most often, `createdBy`) and sets aside (`IGNORED`) every waiting report of that place, with `skipId` and the note *Set aside: "…" is a skipped place.* Linked or created reports are never touched.
- **New reports** of a skipped place are set aside as they're imported, but only when they'd otherwise wait: one that matches an activity still links or creates its job as usual. The robot's summary line counts them as *set aside N (skipped places)*, and a preview as *N set aside (skipped places)*.
- **Stop skipping** (`stopSkipping`, under **Skipped places**) deletes the row and puts the reports it set aside back to `UNMATCHED`. Who took a report off its activity decides what happens next, and its note says which: one never taken off is tried again by the robot (`checkedAt` cleared); one the robot took off goes to put-back, which only puts it on a shift it fits (`checkedAt` cleared); one a person took off waits for a person. A report set aside by hand isn't affected.
- Both write a history line (`fastfield_skip_place`, `fastfield_stop_skipping`) with who did it.
- Nothing is deleted. A set-aside report stays in the database, which also keeps the robot from importing it again: it imports only submission ids it hasn't seen.

### Setting a report aside

**Set aside** (a test, a duplicate) on a waiting report sets it `IGNORED`. Only a report on nothing can be set aside, and the update is conditional, so a report being attached at the same moment never is. The robot never touches a set-aside report. Admin → FastField lists them under **Set aside**: the last 60 days, newest first (a skipped place's reports are under Skipped places; the reports the import refused show here too, with their note). **Bring back** returns one to Needs linking, takes it out of any skipped place and clears `checkedAt`. Who took it off its activity before still counts: one a person took off waits for a person, and one the robot took off only goes back on a shift it fits. History: `fastfield_set_aside` / `fastfield_brought_back`.

### The 24 Nov first-check review

On 24 Nov 2026, between 06:30 and 19:30 UTC, the robot's first shift checks moved or took off every report on a shift it didn't fit. That very likely included some a person had put there by hand on purpose, before anything recorded hand links, and their "Linked by …" notes were overwritten, so the data can't show which. So Admin → FastField lists, at the top, every report the robot moved or took off in that window (from the shifts' history: `fastfield_moved_off`, and `fastfield_unlinked` with `by: "robot"`), with the shift it was on before (`fastfieldFirstCheck.ts`):
- **Put back** puts the report back on that shift as a hand link, so the robot then leaves it there, fit or not. A free report is linked there by hand; one the robot moved to another shift moves back with its round, in one transaction, only if it's still where it was read; one the robot put back on that very shift just becomes a hand link (**Keep it on this shift**). Nothing is billed.
- **Leave it** leaves it as it is.

Either way it gets a `fastfield_first_check_reviewed` line and drops off the list. Reports linked by hand since aren't listed, nor those whose shift was deleted (counted under the list). The section disappears once none are left.

## Rules at a glance

The owner's rules, as the code applies them:

1. **Typed times only.** A report's time comes only from the times typed in the form: from the typed arrival to the typed departure, and one typed time is that moment. Nothing else ever stands in — not the phone's opened / finished times, not when a field was tapped, not the send time. A report with no usable typed time waits for a person; the times written on an activity are only the typed ones; a robot link made before this rule with no typed time is kept and listed in "On a shift, outside its time" for a person.
2. **Shift fit.** The robot only ever puts a report on a shift it fits: the report starts no earlier than 30 minutes before the shift starts and ends no later than 30 minutes after it ends. The shift's window runs from the earliest of its scheduled and actual start to the latest of its scheduled and actual end.
3. **Hand links are unrestricted.** A person can link any report to any shift, job or visit. The robot never moves or takes off a hand link.
4. **The 5-minute shift check.** The robot re-checks its own shift links and moves a report that no longer fits to another shift at the site that it fits, or takes it off — except one that has already gone to the client, which stays for a person.
5. **Who took it off decides what happens next.** A report a person took off is never linked again by the robot. One the robot took off (or that came off a deleted activity) may be put back by the robot onto a shift it fits — never onto a job or visit, and never by making a job.
6. **One report per activity, by the robot.** When the best-matching job or visit already has a FastField report, the robot doesn't put the new one on a different activity instead: it waits for a person ("already has a report"). Shifts take any number of rounds.
7. **Never revive cancelled work, never bill or pay twice.** The robot never attaches to cancelled work, and a person's link to it changes nothing on it. A report is claimed before it's attached, so it can only ever be on one activity. Billing and pay fill only empty amounts, inside the link's transaction. A shift link bills nothing, and a hand link to a job that stands for a shift leaves the job alone.

## Business rules & invariants

- **Nothing is imported until a form is On.**
  - A form seen for the first time is `OFF`, with a starting guess at its settings taken from its name:
    - "Shurgard" → Shurgard only, makes the job;
    - "patrol" → patrols, any client;
    - "alarm" / "call out" → callouts, any client, makes the job at Shurgard sites.
  - The migration set the three forms above to **Preview only**, so the first preview shows what they would do.
  - Switching a form to **On** at `/admin/fastfield` is what starts the import.
- **Jobs are only made at the client the form names** under *Make the job* (Shurgard): never for other clients, never while a static shift the report fits is on, never when the nearest activity (or the nearest of the same kind within 18 hours) already has a report — so two reports of one callout never create two jobs — and never for a report the robot took off.
- **One report per job or visit, by the robot.** By hand, an admin may link a second report to the same activity. Shifts take any number of reports.
- **Idempotent.** `submissionId` is unique, and the plan skips imported ids (refused reports too, once kept). If an overlapping run inserts the same report, the insert hits P2002 and is counted as already imported.
- **Never overwrite.** Attaching only fills empty job or visit times, GPS, officer, photos and finance. It never changes a finished status (`APPROVED`, `SENT_TO_CLIENT`, `CLOSED`, a `COMPLETED` visit, …), never reopens cancelled work, and never changes shifts.
- **Privacy.**
  - The robot logs counts only, with forms by number, and of the app's error answers only their short codes. It saves no capture files; the repo's Actions logs are visible to anyone with access.
  - The import routes answer errors with a fixed message and a short `code` (a 400 names where the problem is, in `fields`, never the values), and the server logs error codes only, never the message.
  - Photo and signature addresses must be https, on Vercel Blob's public storage, under `uploads/fastfield/`; any other is dropped at import, and the answers view only puts http(s) addresses in links and images. Photos are public Blob URLs with a random suffix, stored under `uploads/` with the same **180-day** retention as officers' own photos. The originals stay in FastField.
  - History lines hold ids, times, flags and short labels only.

## Entry points

| Entry | Who | What |
|---|---|---|
| `POST /api/imports/fastfield` | the robot (bearer `NEXUS_IMPORT_SECRET`, or `x-import-secret`; fail-closed) | `plan`, `import` (up to 25 reports a call; answers over 500 KB → 413 `report_too_big`), `refused`, `retry` (45 s); `?preview=1` (then `refused` and `retry` do nothing); `run` id for preview counts. A bad body → 400 `invalid_body`, or `invalid_report` when every problem is inside the reports, with up to 5 `fields` paths. `GET` → a health line. |
| `POST /api/imports/fastfield/photo?submission=&name=` | the robot (bearer) | one image that really is a JPEG, PNG or WebP (else 415 `unsupported_type` / `not_an_image`), 4 MB or less (else 413 `too_large`) → `{ url }` |
| `GET /api/cron/fastfield-recheck` | Vercel cron, every 5 min (`CRON_SECRET`) | the shift check (with the stranded release and put-back), then the retry. Each runs on its own: one failing doesn't stop the other, the reply carries its error code, and it's a 500 only when both fail. |
| `/admin/fastfield` | admin (the page guard; every action checks `requireAdmin`) | the 24 Nov first-check list (while any are left); form settings with the last preview; "Waiting, by place" with **Skip**; "Skipped places" with **Stop skipping**; "On a shift, outside its time" (last 14 days) with **Unlink**; "Needs linking" (the latest 50, when each was last tried, how many were taken off by a person and by the robot) with **Try matching again**; "Recently attached" (the latest 15, by when they were attached, marked when by hand); "Set aside" (last 60 days) |
| `/admin/fastfield/[id]` | admin | one report: answers, photos, its own time, the typed arrival and departure, how it matched. On a shift: whether it fits, with **Unlink from this shift**. On a job or visit (or the job it made): **Unlink from the …**. Waiting or set aside: the hand-link list with **Link**, **Create job**, and **Set aside** / **Bring back**. |
| `/admin/reports/[id]` | admin, dispatcher | a FastField-sourced submission shows the FastField answers; "How it was matched →" for admins only |
| `/shifts/[id]` | admin, dispatcher | "FastField patrol reports": every report on the shift — the robot's rounds and any linked by hand (marked "Linked by hand") — each with its own time; any outside the shift's time are flagged; admins can **Unlink** each. The shift's history names the robot's moves, take-offs and put-backs. |
| Claude connector `review_fastfield` | admin | a read-only review of the matching (see [`17-claude-connector.md`](./17-claude-connector.md)) |

## Extension points & gotchas

- **Changing a rule.** Bump `FASTFIELD_RULES_VERSION` (`src/lib/fastfieldRulesVersion.ts`) by one in the same change, and add a line to its history. Every report is then judged once more: robot shift links by the shift check, robot take-offs by put-back, waiting reports by the retry. It replaced the "rules changed at" times of 24 Nov 2026, which were set before the deploy finished, so reports the old code judged during the deploy were never looked at again.
- **Portal changes.** The robot relies on FastField's internal portal commands, not a public API. If FastField changes them, run **FastField discovery** (manual, values masked) and compare. The *Recent Submissions* card must stay on the robot login's dashboard.
- **The send time** is FastField's `updatedAt` as the robot reads it; no separate sent time is known. Whether it moves when a submission is edited later in the portal is unchecked (a discovery run would show the submission's other keys, the card rows' keys, and whether `updatedAt` moves on later edits). If it does, an edited report's typed times can fall outside the 72-hour window and be dropped (the report then waits for a person).
- **Links made before 25 Nov 2026** have no `prev` record, so Unlink can't undo what they changed on a job or visit. It says so in its `check` list.
- **The daily-email check copies `loadShurgardReport`.** `fastfieldSentToClient.ts` mirrors which activities a day's email covers; keep the two in step when the email changes. The client portal isn't counted as sent, so the robot may still move a report a client has seen there.
- **Refused reports** are kept without their answers. To import one after a fix, delete its row and run the robot over its date.
- **Volume.** About 80 submissions a day across 12 forms (mid-October 2026), most of them Site Patrol rounds. If a preview shows many patrol reports as "nothing near the time", the static shifts for those sites probably aren't in the app for those dates.
- **Postcodes** are matched exactly against `Site.postcode` after removing spaces and capitalising. A postcode that isn't one of ours falls back to name matching.
- **Three-state answers** are shown as 0 = No, 1 = Yes, 2 = N/A, like the app's own tri fields.
- **Repeating sections** in a form are kept as raw values. Their photos are still copied and listed under "Other photos".
- **A different login.** The robot needs a single-account FastField login without 2-step verification. The `FASTFIELD_ORG_ID` secret is only used by the discovery robot.
