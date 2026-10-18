# FastField sync (officers' FastField reports → activities)

Logs into FastField every 4 hours, reads the reports our officers filed, and
attaches each one to the callout, patrol or lock-up it's about — photos,
signature, times and all. Architecture and matching rules:
[`system/18-fastfield.md`](system/18-fastfield.md).

```
GitHub Actions (every 4 h)        FastField portal         The app (Vercel)
──────────────────────────        ────────────────         ────────────────
scripts/fastfield-forms.mjs ─login─► list submissions
        │  ── plan (which are new?) ───────────────────►  /api/imports/fastfield
        │  ◄─ read report + photos
        │  ── photos ──────────────────────────────────►  …/fastfield/photo → Blob
        └─ ── report ──────────────────────────────────►  match site + activity,
                                                           attach, bill, pay
```

## One-time setup

1. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   `FASTFIELD_USERNAME`, `FASTFIELD_PASSWORD` — a FastField login that can see
   all submissions (no 2-step code). `NEXUS_IMPORT_SECRET` is already there.
2. **Let the robot list the forms** — wait for the next 4-hourly run, or run
   **Actions → FastField forms → Run workflow** with Preview ticked.
3. **Admin → FastField** (`/admin/fastfield`): each form appears. Pick the
   client for the callout forms; the Shurgard form comes pre-set to Shurgard
   with *Create callouts* on. Leave *Import* off for now.

## First import (backfill from 1 Sept 2026)

1. **Preview**: Actions → **FastField forms** → Run workflow → From
   `2026-09-01`, Preview ✔. The log ends with e.g. *"Preview OK — would have
   linked 812 (420 callouts, 300 patrols, 92 lock-ups), created 95, unmatched
   40 (…)"*. Nothing is written except the form list.
2. If the numbers look right, tick **Import** on the forms at `/admin/fastfield`
   and **Save**.
3. **Import**: run the workflow again with From `2026-09-01` and Preview
   **un**ticked. It stops cleanly after about 110 minutes; if the log says
   *"Stopped after … — the next run carries on"*, run it again (already-imported
   reports are skipped).
4. From then on the 4-hourly run keeps it up to date (last 3 days each time).

## Day to day

- `/admin/fastfield` → **Needs linking**: reports that didn't match on their
  own. Open one, pick the site, then **Link** the right activity, **Create
  job**, or **Set aside** (tests, duplicates). **Try matching again** re-checks
  them all, e.g. after logging a missed callout.
- On a job or patrol visit, the attached report shows as *FastField report* and
  opens in the review page with all answers and photos.

## If it fails

The run log says why in one line (counts only — no client data). Common ones:
*"login didn't go through"* (password changed — update the secret), *"asked
for a two-step login code"* / *"verify a new location"* (log in to FastField
once by hand from a browser, or use a login without 2-step), *"no Recent
Submissions card"* (add the card back to that login's FastField dashboard).
For anything else, run **FastField discovery** (manual) and compare.
