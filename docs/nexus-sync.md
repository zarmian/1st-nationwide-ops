# Nexus sync (automatic site import)

Logs into the Nexus portal on a schedule, downloads the sites/rates export, and
feeds it straight into the app's existing Nexus importer — no manual upload.

## How it fits together

```
GitHub Actions (nightly)         Nexus portal            The app (Vercel)
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
   Preview and it runs nightly (`30 5 * * *`, adjustable in the workflow file).
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

- **Workflow:** `.github/workflows/nexus-callouts.yml` — nightly at 06:00 UTC
  (30 min after the sites sync, so callouts match against freshly-synced sites)
  and on demand (Actions → **Nexus callouts** → Run workflow, with a **Preview**
  toggle for a dry run).
- **Reader:** `scripts/nexus-callouts.mjs` logs in (same pinned flow), opens
  `/Dashboard`, parses each `LINK-…` activity, and POSTs them as JSON to
  `/api/imports/nexus-callouts`. It also uploads a capture artifact
  (`nexus-activities.json` + HTML + screenshot) every run for audit.
- **Endpoint:** `/api/imports/nexus-callouts` — same `NEXUS_IMPORT_SECRET`
  bearer, fail-closed. Body is `{ "activities": [ … ] }` (or a bare array);
  `?preview=1` reports without writing.

### Extra GitHub secret

Add one secret alongside the sites-sync ones (login + `NEXUS_IMPORT_SECRET` are
shared):

| Secret | Value |
| --- | --- |
| `NEXUS_CALLOUTS_URL` | `https://1st-nationwide-ops.vercel.app/api/imports/nexus-callouts` |

With `NEXUS_CALLOUTS_URL` unset the robot only parses + uploads the capture
(discovery mode) — handy for confirming a parse before going live.

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
- **Auto-drop:** an **OPEN** stub that's no longer on the dashboard is
  auto-cancelled (reversible). Only ever OPEN ones — anything an officer has
  picked up, or a human cancelled, is left alone. Guarded on a **non-empty**
  read, so a transient blank dashboard never cancels the board.

## Notes & caveats (both robots)

- **Idempotent:** upsert-only, so re-running is safe.
- **Fragile by nature:** if Nexus redesign their dashboard the callouts parse
  may return 0 rows — the robot then skips posting (empty-snapshot guard) and
  fails the run so GitHub emails the owner. Check the capture artifact's
  `nexus-dashboard.html` and adjust `scripts/nexus-callouts.mjs`.
