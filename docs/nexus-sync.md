# Nexus sync (automatic site import)

Logs into the Nexus portal on a schedule, downloads the sites/rates export, and
feeds it straight into the app's existing Nexus importer — no manual upload.

## How it fits together

```
GitHub Actions (daily)           Nexus portal            The app (Vercel)
────────────────────────         ────────────            ────────────────
scripts/nexus-sync.mjs  ──login──►  download CSV
        │
        └── POST CSV (Bearer secret) ─────────────────►  /api/imports/nexus
                                                          runs runNexusImport()
                                                          upserts sites + rates
```

The browser robot runs in **GitHub Actions** (not Vercel — Vercel can't run a
browser). It authenticates to the app with a shared secret.

## One-time setup

### 1. App secret (Vercel)

Add an env var in Vercel (Project → Settings → Environment Variables):

- `NEXUS_IMPORT_SECRET` — a long random string. Until this is set, the import
  endpoint refuses everything (fail-closed).

Redeploy so it takes effect.

### 2. GitHub repository secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `NEXUS_USERNAME` | Portal login. |
| `NEXUS_PASSWORD` | Portal password. |
| `NEXUS_IMPORT_URL` | `https://1st-nationwide-ops.vercel.app/api/imports/nexus` |
| `NEXUS_IMPORT_SECRET` | **The same value** you set in Vercel above. |

Credentials live only in GitHub's encrypted secrets — never in the code or the
database.

The login is already pinned to the real portal (`link.linkbynexus.co.uk`:
fields `#Username` / `#Password`, "Login" button, anti-forgery token, no 2FA),
so no login selectors are needed. Optional overrides if anything ever moves:
`NEXUS_REPORT_URL` (defaults to `…/Reports/Sites`), `NEXUS_EXPORT_URL` (a direct
download link) or `NEXUS_EXPORT_SELECTOR` (the export button).

### 3. Pin the "active" filter + export control (only if auto-detect misses them)

The robot logs in, opens the Sites report, **sets the filter to active sites**,
then clicks **Export CSV**. Both steps are best-effort auto-detect; pin them if
needed:

- `NEXUS_ACTIVE_FILTER_SELECTOR` + `NEXUS_ACTIVE_FILTER_VALUE` — the filter
  control and the value/label for "active" (defaults to auto-detecting an
  "Active" dropdown option or checkbox).
- `NEXUS_EXPORT_URL` (a direct download link — best, if the button is a plain
  link) or `NEXUS_EXPORT_SELECTOR` (the export button).

To check:

1. Actions tab → **Nexus sync** → **Run workflow**, tick **Preview only**.
2. If it reports `Preview OK — would create … update …`, you're done — untick
   Preview and it runs daily at 05:30 UTC (`30 5 * * *`, adjustable in the
   workflow file). The site list changes rarely, so it stays daily; the
   activity syncs below run every 4 hours.
3. If it fails at the export step, download the **nexus-sync-debug** artifact
   (screenshot + page HTML), find the real export control, and set either:
   - `NEXUS_EXPORT_URL` — a direct download link, if the report offers one; or
   - `NEXUS_EXPORT_SELECTOR` — a CSS selector for the export button.
   Then re-run Preview. (Send me that screenshot/HTML and I'll set it for you.)

## Testing the endpoint by itself

```
curl -X POST "https://1st-nationwide-ops.vercel.app/api/imports/nexus?preview=1" \
  -H "Authorization: Bearer <NEXUS_IMPORT_SECRET>" \
  -H "Content-Type: text/csv" \
  --data-binary @nexus-export.csv
```

`preview=1` reports what would change without writing. Drop it to import for real.

## Notes & caveats

- **Idempotent:** the importer upserts (never deletes), so re-running is safe. A
  destructive reset stays a deliberate, admin-only action on `/admin/imports/nexus`.
- **Fragile by nature:** scraping a portal breaks if Nexus redesign their site —
  when that happens the workflow fails and GitHub emails the repo owner; fix the
  selectors (step 3) and re-run.
- **Terms of use:** confirm automated login is acceptable under Nexus's terms.

## Callouts (dashboard → job stubs)

The Nexus **dashboard**'s "Upcoming Activities" list (VPI callouts they've sent
us) can't be exported like the Sites report, so a second robot reads it off the
screen and turns each row into an internal **job stub** the office can assign.

- **Schedule:** every **4 hours** as the first step of **Partner syncs**
  (`.github/workflows/partner-syncs.yml`, at 01:07 / 05:07 / 09:07 / 13:07 /
  17:07 / 21:07 UTC — callouts, then completed activities, then Keyholding, in
  one run). By hand: Actions → **Nexus callouts** → Run workflow, with a
  **Preview** toggle for a dry run.
- **Nexus's annual "Review Details" check:** once a year Nexus intercepts the
  dashboard with a 4-step review of the business details it holds. A person
  must complete it (the robot never clicks through a declaration); until then
  the callouts run fails with a message saying exactly that. The Activities and
  Sites pages aren't blocked, so those syncs keep working.
- **Quiet hours:** a dashboard that loads fine with nothing listed is a normal
  run (nothing imported, nothing auto-dropped), not a failure.
- **Reader:** `scripts/nexus-callouts.mjs` logs in (same pinned flow), opens
  `/Dashboard`, parses each `LINK-…` activity, and POSTs them as JSON to
  `/api/imports/nexus-callouts`. The log shows counts only. A capture
  (`nexus-callouts.json` + HTML + screenshot) is kept only when a run fails
  or is started by hand, for 1 day — see *Logs and captures* below.
- **Endpoint:** `/api/imports/nexus-callouts` — same `NEXUS_IMPORT_SECRET`
  bearer, fail-closed. Body is `{ "activities": [ … ] }` (or a bare array);
  `?preview=1` reports without writing.

### Extra GitHub secret

Add one secret alongside the sites-sync ones (login + `NEXUS_IMPORT_SECRET` are
shared):

| Secret | Value |
| --- | --- |
| `NEXUS_CALLOUTS_URL` | `https://1st-nationwide-ops.vercel.app/api/imports/nexus-callouts` |

With `NEXUS_CALLOUTS_URL` unset the robot only parses + saves the capture
(discovery mode; start it by hand to get the capture) — handy for confirming a
parse before going live.

### What the stubs look like

Each callout becomes a `Job`: type **VPI**, `source = PARTNER_REQUEST`, tied to
the **Nexus** partner, `reportedViaPartnerApp = true` (our officer fills Nexus's
app — no ClientReport), status **OPEN**. `scheduledFor` is the window's end
(the completion deadline); the full window, service code, Nexus status and
address go in the notes. Sites are matched by postcode (then by name when a
postcode is shared); an unmatched callout still becomes a stub with the address
in the notes so nothing is dropped.

- **Dedup key:** `Job.partnerActivityRef` (the `LINK-…` reference, UNIQUE). A
  re-run updates the same stub; two genuine callouts on one site (different
  references) stay two stubs.
- **Patrols already on our schedule** get no stub — the callout links to the
  patrol visit instead (see [below](#patrols-already-on-our-schedule)). It
  isn't a new callout, so no alert.
- **Auto-drop:** an **OPEN** stub that's no longer on the dashboard is
  auto-cancelled (reversible). Only ever OPEN ones — anything an officer has
  picked up, or a human cancelled, is left alone, and never a patrol visit.
  Guarded on a **non-empty** read, so a transient blank dashboard never
  cancels the board.
- **Times** on the dashboard are UK time (BST in summer), like the Activities
  report. Before October 2026 the callouts import read them as UTC, so in
  summer a callout's deadline showed an hour late; open stubs correct
  themselves on the next run.
- **Alert:** when a run creates new callouts, the office gets one summary
  notification (the **New Nexus callout** kind — dispatchers + admins, Telegram
  by default; change it on `/admin/notifications/settings`). Deduped on *which*
  callouts are new (a callout is only ever new once), so each new batch alerts
  exactly once — later batches the same day still get through. A backfill posts
  with `?notify=0` to stay silent.

## Completed activities (Activities report → job stubs)

Nexus's **Activities** report (`/Activities`, filtered to *Completed*) lists the
work we've actually done for them — VPIs, mobile patrols, alarm responses,
stop-the-clocks. Its filters live entirely in the URL (`ActivityStatus=9`, a
`DueDateFrom`/`DueDateTo` window), so the robot just builds the URL, pages
through the 50-rows-per-page results, and imports each row as a **completed**
job stub.

- **Schedule:** every **4 hours** in **Partner syncs** (a rolling
  last-3-days window). By hand: `.github/workflows/nexus-activities.yml` with
  **From / To / Preview** inputs (use Preview + a wide window for a backfill).
- **Reader:** `scripts/nexus-activities.mjs` — logs in, paginates, maps each
  table row (Reference / Type / Site / Site Address / SIN / Customer / Due Date
  / Time on/off Site / Status) and POSTs to `/api/imports/nexus-activities`.
- **Endpoint / lib:** same `NEXUS_IMPORT_SECRET` bearer; `src/lib/nexusActivities.ts`.

### Extra GitHub secret

| Secret | Value |
| --- | --- |
| `NEXUS_ACTIVITIES_IMPORT_URL` | `https://1st-nationwide-ops.vercel.app/api/imports/nexus-activities` |

### What the stubs look like

A `Job` at status **APPROVED** (completed), tied to the **Nexus** partner,
`reportedViaPartnerApp = true` (no client report). `scheduledFor` = the Due
Date (window start), `startedAt` = Time on Site, `completedAt` = Time off Site;
type mapped from Nexus's (VPI / PATROL / ALARM_RESPONSE / ADHOC). Sites are
matched by **SIN** first (`Site.partnerSin`), then postcode + name.

- **Dedup:** the `LINK-…` reference (`Job.partnerActivityRef`). A re-run updates
  the same stub — and a completed activity we'd already imported as an upcoming
  callout **upgrades that stub to completed** instead of duplicating.
- **Possible-duplicate flag:** if an imported activity looks like a job someone
  entered **by hand** (same site, type and time, no `LINK-` reference), the stub
  is marked `possibleDuplicate` and shows a ⚠ badge on the Activities log — so
  you can check before billing/paying twice. Nothing is blocked or merged.
- **Note:** the report doesn't name which of *our* officers attended, so stubs
  import unassigned; assign the officer if you need it for pay.
- **Patrols already on our schedule** get no stub — the activity completes the
  patrol visit instead (see below).

### Patrols already on our schedule

Some Nexus sites are on our own patrol schedule too. Swail House is one: our
schedule makes a 22:00 patrol, and Nexus sends the same patrol with a
19:00–23:00 window. Each Nexus import used to make a job stub for it, so the
one patrol showed twice. Now a Nexus **patrol or VPI** is matched to the visit
on our schedule, and its `LINK-…` reference goes on the visit
(`PatrolVisit.partnerActivityRef`), the way Keyholding patrols link
(`src/lib/nexusVisits.ts`):

- **Match:**
  - The visit must be at the same site, not cancelled, and not linked to
    another activity.
  - Its time must fit. For a completed activity, that's within **3 hours** of
    when the officer was on site. For an upcoming one, it's inside the **due
    window**, with an hour's slack either side.
  - **Weekly VPIs:** a window longer than a day matches the one visit of ours
    inside it. The Queen of the South is the example: Nexus gives a week
    from Monday 00:00, our VPI is scheduled Monday 20:00, and the officer
    often does it the following Monday morning. When the end of the window
    isn't known, it runs to when the officer was on site. If several of our
    visits fall inside the window (daily patrols against a weekly VPI), it
    matches none of them and stays a stub.
  - Best fit first, one visit per activity, so a site with two patrols a night
    pairs each with its own Nexus activity.
  - **One site, two records:** a Nexus job only meets our patrol if both are
    on the same site record. Swail House was set up by hand, then the Nexus
    site import created a second record for it. The two records have been
    merged (`src/lib/siteMerge.ts`, see below). When two sites share a
    postcode, both Nexus imports prefer the live one over a switched-off copy.
- **Completed:**
  - The visit moves forward to **completed**, never back. That includes one we
    had marked late or missed, because the officer recorded it in Nexus's app.
  - Arrival and departure times it lacks are filled in from Nexus.
  - Billing and officer pay are snapshotted where missing, as when the office
    closes a visit for an officer.
  - The visit's officer, client and partner are never taken from Nexus.
  - A note on the visit records the reference and the on-site times, and the
    visit's history shows *Linked to its Nexus activity*.
- **Stubs from before:** a stub an earlier import made for the patrol is
  **merged** into the visit. The reference moves to the visit, the stub is
  deleted, and the stub's officer is carried over if the visit has none.
  - A stub is only merged if nobody has worked on it: no invoice, billing or
    pay, no report, not in progress, not handed to a partner, not cancelled by
    hand, and not a different officer from the visit's.
  - Otherwise it stays, marked ⚠ possible duplicate, for the office to decide.
- **The clean-up:**
  - The imports only see the last few days. So the older completed stubs, back
    to September 2026 when the Nexus imports began, are merged nightly by the
    `patrol-visits` cron, and on demand by **Patrols → Clean up duplicates**.
    The owner chose to include September (October 2026).
  - A visit the clean-up completes gets its billing and pay at its own
    scheduled date. For September, only The Queen of the South on 28 September
    changed from missed to done; the others were already done.
  - It runs straight after the site merges, so jobs moved onto the real site
    are matched the same night.
- **The robots' logs** count the links, merges and ⚠ flags (counts only).

### Merging a duplicate site record

`src/lib/siteMerge.ts` (`mergeSiteInto`, run for each pair in `SITE_MERGES`):
- **What moves:** every job, patrol, schedule, shift, alarm, key, key set,
  report, form template and onboarding record moves from the copy to the real
  site.
- **One-per-site items:** access instructions and each service's rate stay on
  the copy when the real site already has its own.
- **Partner references:** the real site takes the copy's partner, Nexus
  reference, SIN and other Nexus metadata wherever it has none. So the daily
  Nexus site sync then updates the real site (name, address, flags and rates
  from Nexus, as for every Nexus site) and doesn't recreate the copy.
- **The copy:** it's switched off and keeps a note saying where it went. Both
  sites' history shows the merge.
- **Re-runs** do nothing.
- **When it runs:** nightly from the `patrol-visits` cron and from **Clean up
  duplicates**.
- **Adding a merge:** add the pair to `SITE_MERGES` once the office has
  confirmed the two records are one site. The Sites list already highlights
  suspected duplicates (same name or postcode).

## Notes & caveats (both robots)

- **Logs and captures — keep client data out.** Treat Actions logs and
  artifacts as visible to anyone with access to the repository (it was public
  until October 2026). So the robots log **counts only**, and captures (parsed
  rows + page HTML + screenshot, which hold site names and addresses) are
  uploaded **only when a run fails or is started by hand**, kept **1 day**.
  Keep it that way when changing a robot.
- **Idempotent:** upsert-only, so re-running is safe.
- **Fragile by nature:** if Nexus redesign their dashboard the callouts parse
  may return 0 rows — the robot then skips posting (empty-snapshot guard) and
  fails the run so GitHub emails the owner. Check the capture artifact's
  `nexus-dashboard.html` and adjust `scripts/nexus-callouts.mjs`.
