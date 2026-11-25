# FastField sync (officers' FastField reports → activities)

Logs into FastField every 4 hours and reads the reports our officers filed. Each report is attached to what it's about, with photos, signature and times, going by the times typed in it (or when it was sent, if none were typed):
- a patrol round goes to a static shift it fits: it can't start more than 30 minutes before the shift starts or finish more than 30 minutes after it ends;
- a callout, patrol or lock-up goes to the job or visit nearest in time at the site (within 3 hours, or the same kind of work within 18 hours), which is marked done, billed and paid. If that one already has a report, the new report waits for you instead.

Every 5 minutes the app also re-checks the reports the robot put on shifts, and tries the waiting ones again.

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

Vercel cron (every 5 min) ─────────────────────────────►  check the robot's shift
                                                           links, try waiting
                                                           reports again
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

- **Needs linking** on `/admin/fastfield` lists the reports that didn't match on their own, newest first, with when the robot last tried each:
  - open one, pick the site, then **Link** the right shift or activity. Everything at the site from 3 days before to 3 days after the report is listed (or pick another day), including what the robot would skip, each marked. You're asked to confirm first, and warned if it's a different client's. The robot leaves a report you link by hand where you put it;
  - or **Create job**;
  - or **Set aside** (for tests and duplicates). Set-aside reports are listed under **Set aside**, where **Bring back** returns one to Needs linking.
  - **Try matching again** runs the robot's matching now, for example after you add a missing shift or callout. It covers the reports from the last 60 days on forms set to On, except any taken off an activity, for up to 35 seconds; press again to carry on. If the robot is matching at that moment, it says so. (The robot does this by itself every 5 minutes, for the last 30 days.)
- **Unlink** takes a report off whatever it's on — a shift, a job, a patrol visit, or the job made from it — after you confirm. On a job or visit, what the link did (marked it done, billed it) is undone where that's safe, and anything it couldn't undo is listed for you to check. The robot never links that report again: link it to the right activity, or set it aside.
- **The robot checks its own shift links every 5 minutes.** A report it put on a shift that no longer fits (its times or the shift's changed) is moved to a shift there that it fits, or taken off to wait in Needs linking; it never goes onto a job or visit. One already sent to the client stays where it is for you to decide. If a shift is added or changed later and a report the robot took off now fits it, the robot puts it back. **On a shift, outside its time** lists any waiting for that (the last 14 days). Reports you linked by hand are never moved.
- **Deleting a shift** takes its reports off it first. The robot puts each one on another shift there that it fits; otherwise it waits in Needs linking.
- **Waiting, by place** groups the waiting reports by the site the officer typed. **Skip** a place you don't need its reports for, such as a site that isn't in the app. All its waiting reports are set aside, and new ones typed the same way are set aside as they arrive, unless they match an activity. **Skipped places** lists them, and **Stop skipping** brings their reports back. Nothing is deleted.
- **Reports the app couldn't import** (too big, or with something in it the app couldn't read) are listed under **Set aside** with a note saying so; read them in FastField. The robot doesn't try them again. To import one after a fix, its row has to be deleted and the robot re-run over its date.
- **Checked by the robot on 24 Nov** (at the top of the page, while any are left) lists the reports the robot's first shift check moved or took off, some of which may have been linked by hand. **Put back** each one on the shift it was on (as a hand link), or **Leave it**.
- On a job, patrol visit or shift, the attached report shows as a *FastField report*. It opens in the review page with all its answers and photos.

## If it fails

The run log gives the reason in one line, with counts only and no client data. Common ones:

| Log says | What to do |
|---|---|
| *"login didn't go through"* | The password changed: update the secret. |
| *"asked for a two-step login code"* or *"verify a new location"* | Log in to FastField once by hand from a browser, or use a login without 2-step. |
| *"no Recent Submissions card"* | Add the card back to that login's FastField dashboard. |
| *"Couldn't import N reports (too big, or unreadable)"* | Nothing is lost: they're under **Set aside** on Admin → FastField, with the reason. Read them in FastField. |
| *"… left out (not on our storage)"* | Some photo links weren't on the app's own storage, so they were left out. If it keeps happening, the photo upload needs checking. |
| *"Earlier unmatched reports weren't re-checked: the app was already doing it."* | Nothing to do: the app was matching at that moment, and its 5-minute check carries on. |

For anything else, run **FastField discovery** (manual) and compare.
