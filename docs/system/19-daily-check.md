# 19 — Daily check

## Purpose & scope

Every morning the app looks over everything since the last check and tells the office what needs a look. It is emailed, and the history is on **Admin → Daily check** (`/admin/daily-check`).

| Section | What it catches |
|---|---|
| **Incidents and security issues** | **Claude** reads the FastField reports that came in and lists real incidents, each rated high / medium / low: break-ins, damage, intruders, police or fire called, doors or gates found open, alarm faults, injuries, people locked in. If Claude isn't configured or can't be reached, a keyword scan stands in. |
| **Possible duplicates** | The same visit recorded twice at a site. The motivating case is **Swail House**: our patrol schedule makes a 22:00 visit, and the Nexus activities import adds a stub for the same patrol (window 19:00–23:00). Another case is a callout logged by the office that was also made from a FastField report. |
| **Missing reports** | Our own officers' jobs, patrols and static / dog-handler shifts with no report attached. A report can be a FormSubmission, a FastField report, or a shift check-in. Work reported in a partner's own app is left out: `reportedViaPartnerApp`, partner-handled work, Nexus sites, Keyholding sites, and Keyholding customer sites. This section runs only once at least one FastField form is **On**. |
| **FastField report problems** | The phone's GPS was more than 500 m from the site, or beyond the site's own geofence if that is larger. The typed site name reads like a different site, or the typed postcode is another site's. The form doesn't fit the job (a patrol form on a callout, a callout form on a patrol or shift, an unlock on a lock-up). The named officer isn't on the staff list, so pay can't be matched. |
| **Syncs** | When FastField, Nexus and Keyholding last synced. A sync is flagged *late* after 8 hours, which is two missed 4-hourly runs. Also shows how many FastField reports are waiting to be linked by hand. |

Claude also writes a 2–3 sentence **overview** at the top: how the day went and what to look at first.

## Data model

Migration `20261018180000_daily_check`, additive.

| Model | What it is |
|---|---|
| `DailyCheck` | One row per run. `periodStart` / `periodEnd` mark which activities were checked. `findings Json` holds the sections (`DailyCheckFindings` in `lib/dailyCheck.ts`), `counts Json` the per-section counts and `total`, and `overview` Claude's text. `trigger` is `cron` or `manual`. `emailedTo` / `emailedAt` record the email. |
| `DailyCheckSettings` | A single row (id 1): `enabled` (default on) and `recipients` (comma-separated; empty means `ADMIN_EMAIL`). |

## Key files

| File | Role |
|---|---|
| `src/lib/dailyCheckRules.ts` | Pure rules: `findDuplicatePairs`, `reportIssues`, `keywordIncidents`, `reportText`. Tests: `dailyCheckRules.test.ts`. |
| `src/lib/dailyCheck.ts` | `runDailyCheck`: works out the period, loads jobs, visits, shifts and reports, asks Claude, saves the row and emails it (`dailyCheckEmail`). |
| `src/app/api/cron/daily-check/route.ts` | The morning cron, `30 6 * * *` UTC (07:30 BST / 06:30 GMT), which runs after the 05:07 portal syncs. |
| `src/app/(app)/admin/daily-check/*` | The page: settings (on/off, recipients), **Run the check now**, the latest or a chosen check, and the history. |
| `src/lib/anthropic.ts` | `extractWithTool`: a single forced tool call that returns `{ overview, incidents[] }`. |
| `src/lib/email.ts` | Sending, via Resend. |

## Core flow (`runDailyCheck`)

1. **Period.**
   - It runs from the end of the last *morning* run up to an hour before the FastField robot's latest run (`max(FastFieldForm.lastSeenAt)`). This means every activity is checked once, after its report has had time to come in.
   - The first run looks back 24 h. The period is capped at 7 days.
   - **Run the check now** uses the same period but doesn't move it.
2. **Activities.** Jobs (callouts, patrols, VPIs, lock-ups, unlocks, key jobs) and patrol visits are loaded from 6 h either side of the period, so a duplicate whose other half is just outside still pairs up. Each gets:
   - a **source**: Nexus (`LINK-…` ref), Keyholding, FastField report, Recorded by the office, Our schedule, or Dispatch;
   - a **main time**: when it was done if known, else when it was scheduled.
3. **Duplicates** (`findDuplicatePairs`):
   - **Candidates:** records at the same site, of the same family, whose times (padded by 30 min) overlap. The families are patrol and VPI; callout, ad-hoc and key jobs; lock-ups; and unlocks.
   - **Source rule:** the two records must come from different sources, or be the same type from the same source within 30 min. So our own patrol and VPI at one time are two services, while Nexus's VPI and our patrol are one visit.
   - **Pairing:** each record pairs once, closest first. So a site with two patrols a night pairs each with its own Nexus activity.
   - A job that stands for its own visit (`Job.patrolVisitId`) is never paired with that visit.
4. **Missing reports.** Activities in the period with no report, as described in the table above.
5. **Reports.**
   - Every FastField report that came in since the last morning run (not set aside) is checked with `reportIssues`.
   - Claude reads up to the 200 newest. It gets each report's written answers and Yes/No answers, but not photos, signatures, GPS or links.
6. **Save and email.**
   - The row is saved.
   - The morning run emails the recipients, unless the check is switched off, no recipient is set, or email isn't configured.
   - The email lists up to 25 items per section, with links into the app.

## Business rules & invariants

- **Read-only.** The check never changes an activity or report; it only reports what it finds.
- **Noise control:**
  - "Missing reports" waits until FastField import is on.
  - Partner-app work is left out.
  - Same-source records only pair when they're the same type within 30 min.
- **Privacy.**
  - The FastField answers sent to Claude are the same report text the office already reads, with photos and links left out.
  - The server logs only error codes.
  - Findings stay in the app's own database and the office email.
- **Cost.** One Claude call a day, plus one for each **Run the check now**.

## Extension points & gotchas

- **Root cause of the Swail House duplicate.** `nexusActivities.ts` only flags a stub as a `possibleDuplicate` against manually entered jobs, not against our own patrol visits. Linking a Nexus activity to the matching patrol visit at import time (as `keyholdingJobs.ts` does) would stop these duplicates at source. Until then, the daily check lists them for the office to cancel one.
- **Partner apps.** The "reported elsewhere" partners are found by name: `NEXUS_PARTNER_NAME`, any partner whose name contains "keyholding", and the Keyholding customer. A new partner whose app our officers fill in would need adding.
- **Claude model.** It uses `ANTHROPIC_MODEL`, or the default in `lib/anthropic.ts`, the same as the Telegram bot.
