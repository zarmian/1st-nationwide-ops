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

### 3. Pin the export control (only if auto-detect misses it)

The robot logs in and opens the Sites report on its own. The last unknown is the
**export/download button** on that report — the script auto-detects a control
labelled *Export / CSV / Download*. To check:

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
- **Callouts (phase 2):** their callout list is also on the portal; once the
  sites sync is proven, the same robot can scrape callouts into an internal
  stub. Needs a callout parser + a `/api/imports/nexus-callouts` endpoint.
