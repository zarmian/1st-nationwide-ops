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
| `NEXUS_PORTAL_URL` | The portal **login page** URL. |
| `NEXUS_USERNAME` | Portal login. |
| `NEXUS_PASSWORD` | Portal password. |
| `NEXUS_IMPORT_URL` | `https://1st-nationwide-ops.vercel.app/api/imports/nexus` |
| `NEXUS_IMPORT_SECRET` | **The same value** you set in Vercel above. |

Credentials live only in GitHub's encrypted secrets — never in the code or the
database.

### 3. Finish the scraper for the real portal

`scripts/nexus-sync.mjs` uses best-guess selectors for the login form and the
export button (marked `TODO(portal)`). To lock them to the real site:

1. Actions tab → **Nexus sync** → **Run workflow**, tick **Preview only**.
2. If it fails, download the **nexus-sync-debug** artifact — it contains a
   screenshot and the page HTML at the point of failure. Read the real field
   names/buttons from it.
3. Set the matching optional secrets (no code change needed) to pin them:
   - `NEXUS_USER_SELECTOR`, `NEXUS_PASS_SELECTOR`, `NEXUS_SUBMIT_SELECTOR`
   - `NEXUS_LOGGED_IN_SELECTOR` — something shown only after login (e.g. a
     "Log out" link) so we can confirm the login worked.
   - `NEXUS_EXPORT_URL` (if the export is a direct link once logged in) **or**
     `NEXUS_EXPORT_SELECTOR` (the export/download button).
4. Re-run in **Preview only** until it reports `Preview OK — would create … update …`.
5. Then run it for real (untick Preview), and it'll go nightly on its own
   (`30 5 * * *`, adjustable in the workflow file).

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
