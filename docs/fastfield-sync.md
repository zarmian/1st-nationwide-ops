# FastField sync (officers' FastField reports → activities)

Logs into FastField every 4 hours and reads the reports our officers filed. Each report is attached to what it's about, with photos, signature and times:
- a patrol round goes to the static shift that was on;
- a callout or lock-up goes to the job.

Architecture and matching rules: [`system/18-fastfield.md`](system/18-fastfield.md).

```
GitHub Actions (every 4 h)        FastField portal         The app (Vercel)
──────────────────────────        ────────────────         ────────────────
scripts/fastfield-forms.mjs ─login─► list submissions
        │  ── plan (which are new?) ───────────────────►  /api/imports/fastfield
        │  ◄─ read report + photos
        │  ── photos ──────────────────────────────────►  …/fastfield/photo → Blob
        └─ ── report ──────────────────────────────────►  find site (postcode,
                                                           name, GPS) + activity,
                                                           attach, bill, pay
```

## Settings per form (Admin → FastField)

| Setting | Choices |
|---|---|
| **Import** | **Off**, **Preview only**, or **On**. Preview only shows what the form's reports would do in a preview run and imports nothing. |
| **Reports** | What the form is for: callouts, patrols / static shifts, lock-ups, … |
| **Sites** | **Any client**: the site in each report decides. Or **only one client's** sites. |
| **Make the job when nothing matches** | **Never**: such reports wait to be linked by hand. Or **at one client's sites** (Shurgard). |

Starting settings:

| Form | Import | Reports | Sites | Make the job |
|---|---|---|---|---|
| Shurgard form | Preview only | callouts | Shurgard only | at Shurgard sites |
| Site Patrol Form | Preview only | patrols / static shifts | any client | never |
| Alarm Response Form | Preview only | callouts | any client | at Shurgard sites |
| Every other form | Off | | | |

## One-time setup

1. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   - `FASTFIELD_USERNAME` and `FASTFIELD_PASSWORD`: a FastField login that can see all submissions and has no 2-step code.
   - `NEXUS_IMPORT_SECRET` is already there.
2. **Admin → FastField** (`/admin/fastfield`): check the three forms' settings above.

## First import (backfill from 1 Sept 2026)

1. **Preview.**
   - In GitHub, go to Actions → **FastField forms** → Run workflow.
   - Set From to `2026-09-01` and leave Preview ticked.
   - Nothing is imported.
   - The log ends with the totals and one line per form number.
   - Admin → FastField shows each form's line, for example: *"Last preview: would link 812 (420 static-shift rounds, 300 callouts, …), create 25; 40 to link by hand (…)"*.
2. If the numbers look right, set those forms to **On** and **Save**.
3. **Import.**
   - Run the workflow again with From `2026-09-01` and Preview **un**ticked.
   - It stops cleanly after about 110 minutes.
   - If the log says *"Stopped after … — the next run carries on"*, run it again. Already-imported reports are skipped.
4. From then on, the 4-hourly run keeps it up to date, covering the last 3 days each time.

## Day to day

- **Needs linking** on `/admin/fastfield` lists the reports that didn't match on their own:
  - open one, pick the site, then **Link** the right shift or activity;
  - or **Create job**;
  - or **Set aside** (for tests and duplicates).
  - **Try matching again** re-checks them all, for example after you add a missing shift or callout.
- On a job, patrol visit or shift, the attached report shows as a *FastField report*. It opens in the review page with all its answers and photos.

## If it fails

The run log gives the reason in one line, with counts only and no client data. Common ones:

| Log says | What to do |
|---|---|
| *"login didn't go through"* | The password changed: update the secret. |
| *"asked for a two-step login code"* or *"verify a new location"* | Log in to FastField once by hand from a browser, or use a login without 2-step. |
| *"no Recent Submissions card"* | Add the card back to that login's FastField dashboard. |

For anything else, run **FastField discovery** (manual) and compare.
