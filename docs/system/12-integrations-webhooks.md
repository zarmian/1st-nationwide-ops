# External Integrations & Webhooks

> The non-Telegram edges of the platform: the bOnline phone webhook (inbound call events → missed-call alerts), postcode geocoding, Vercel Blob media uploads + retention, the command-palette search endpoint, officer live-location, and the Leaflet map.

## Purpose & scope

This document covers every external integration **except** the Telegram bot (which has its own doc, `11-telegram-bot.md`). Each is a thin, self-contained edge with its own secret and its own failure mode:

- **bOnline** — the office phone provider POSTs call events to a webhook; missed inbound calls fan out to dispatch as SMS + Telegram.
- **postcodes.io** — free UK postcode → lat/lng geocoding, used to put site markers on the map.
- **Vercel Blob** — client-direct photo/signature uploads (token-brokered) with a 180-day retention sweep.
- **Command-palette search** — one role-aware cross-entity search endpoint.
- **Officer live-location** — the `/m/today` client posts GPS every few minutes.
- **Leaflet map** — client-only rendering of the above coordinates.

The missed-call SMS/Telegram fan-out itself is documented in `10-notifications.md`; the crons named here (`blob-cleanup`, `sms-queue`) are in `13-crons.md`.

## Data model

### `CallEvent` (`prisma/schema.prisma:1243`)

Every bOnline delivery is stored, parsed-or-not, so the loose parser can be tuned from real payloads.

| Field | Type | Notes |
|---|---|---|
| `provider` | `String` | Defaults `"bonline"`. |
| `externalId` | `String?` | Provider's own call id **when present** — the de-dup key for repeated deliveries of the same call. |
| `direction` | `String?` | `INBOUND` \| `OUTBOUND` \| `UNKNOWN`. |
| `status` | `String?` | Normalised: `MISSED` \| `ANSWERED` \| `BUSY` \| `FAILED` \| `VOICEMAIL` \| `UNKNOWN`. |
| `rawStatus` | `String?` | The provider's own status string, kept for reference/tuning. |
| `fromNumber` / `toNumber` | `String?` | Best-effort. |
| `durationSec` | `Int?` | |
| `missed` | `Boolean` | Drives the alert. Defaults false. |
| `alerted` | `Boolean` | True once a dispatch alert has been queued — the **once-per-call** guard. |
| `occurredAt` | `DateTime?` | Event time from the payload when available. |
| `payload` | `Json` | **Raw webhook body, always kept.** |

Indexes: `occurredAt`, `missed`, `externalId`, `createdAt`.

## Key files

| File | Role |
|---|---|
| `src/lib/bonline.ts` | Pure, defensive payload parser: `parseBonlineCall` + `isUkMobile`. No DB/network — unit-tested. |
| `src/lib/bonlineWebhook.ts` | Shared webhook logic: `bonlineSecretOk`, `bonlineHealth`, `ingestBonline` (upsert + alert). |
| `src/app/api/webhooks/bonline/route.ts` | Query/header-secret URL shape. |
| `src/app/api/webhooks/bonline/[secret]/route.ts` | Path-secret URL shape (for forms that reject query strings). |
| `src/lib/geocode.ts` | `geocodePostcodes` (bulk postcodes.io) + `geocodeSitesMissingCoords` backfill. |
| `src/app/api/blob/upload-token/route.ts` | Brokers a scoped Vercel Blob upload token; enforces upload constraints. |
| `src/app/api/cron/blob-cleanup/route.ts` | 180-day retention sweep of the `uploads/` prefix. |
| `src/app/api/search/route.ts` | Role-aware command-palette search. |
| `src/app/api/officers/me/location/route.ts` | Officer live-location writer. |
| `src/components/map/MapInner.tsx` | Leaflet map (client-only). Wrapped by `DispatchMap.tsx` / `SitesMap.tsx` via `dynamic(..., {ssr:false})`. |
| `src/lib/cronAuth.ts` | `isAuthorisedCron` — `Bearer CRON_SECRET` (open in non-production). |

## Core flows / mechanics

### bOnline call webhook

**Two URL shapes, one handler.** Both exist because some webhook config forms reject query strings:

| Method / URL | Behaviour |
|---|---|
| `GET /api/webhooks/bonline` (either shape) | `bonlineHealth` — a reachability/verify check. Echoes a `challenge` / `hub.challenge` / `verify` query param as `text/plain` when present, else `{ok:true}`. No secret required (nothing sensitive). |
| `POST /api/webhooks/bonline?key=SECRET` (or `x-webhook-secret` header) | Query/header secret. |
| `POST /api/webhooks/bonline/<SECRET>` | Secret is the last path segment. |

- **Auth**: `bonlineSecretOk` compares the provided value to `BONLINE_WEBHOOK_SECRET` and **fails closed** when the env var is unset. Mismatch → `401`.
- **`ingestBonline`**:
  1. `readBody` accepts JSON, `x-www-form-urlencoded`, `multipart/form-data`, or falls back to raw text wrapped as `{_raw: text}` — it never throws.
  2. `parseBonlineCall(payload)` normalises the call (see below).
  3. **De-dup by `(provider, externalId)`**: if a row exists it's *updated* (and its `alerted` flag remembered); otherwise a new `CallEvent` is created. The raw payload is always stored.
  4. **Missed-call alert** (only when `parsed.missed && !alreadyAlerted`): `notifyMissedCall` queues a `MISSED_CALL` SMS to `dispatcherSmsRecipients` (drained by the `sms-queue` cron) **and** `alertMissedCallTelegram` immediately broadcasts to every linked staff chat. If *either* reached someone, `alerted` is set `true` — the once-per-call guard. Both channels are independent, so a Telegram-only team still gets the heads-up. See `10-notifications.md`.

**`parseBonlineCall` — deliberately loose** (bOnline's exact shape is undocumented to the team):
- `flatten` merges one level of a common wrapper key (`data` / `call` / `event` / `payload` / `cdr` / `body`) into a flat bag.
- `pick(bag, keys)` returns the first present, non-empty value among many candidate key spellings, case-insensitively (e.g. `from` / `from_number` / `caller` / `ani` / …).
- **Missed detection**: a boolean flag (`missed` / `isMissed` / `is_missed`) wins; else `MISSED_RE` matched against `rawStatus`; else **`false`** — the parser never guesses "missed", so it can't fire a false dispatch alert.
- `status` is then labelled via regexes (`VOICEMAIL` / `BUSY` / `ANSWERED` / `FAILED`), defaulting `UNKNOWN`.
- `isUkMobile` guards SMS echo (`07…` / `+447…` only).

### Geocoding (`geocode.ts`)

- `geocodePostcodes(list)` bulk-POSTs to `https://api.postcodes.io/postcodes` (**free, no auth**), 100 per batch, and returns a `Map` keyed by *normalised* postcode (spaces stripped, uppercased). Unresolved postcodes are simply omitted; all network errors are swallowed (`continue`).
- `geocodeSitesMissingCoords(prisma, {force?})` finds sites that have a postcode but no `lat`/`lng` (or *all* postcoded sites with `force:true`), writes coordinates back to `Site.lat`/`Site.lng`, and returns `{scanned, geocoded, failed, failures[]}` so an admin sees exactly which postcodes didn't resolve. Idempotent/re-runnable.
- **Callers** (not an HTTP route): `admin/imports/sites/_actions.ts` (backfill + force-refresh buttons), `sites/_actions.ts` (single postcode on save), `lib/sitesImport.ts` (bulk import tail).

### Vercel Blob uploads + retention

**Token broker — `POST /api/blob/upload-token`:**
- The client calls `upload()` from `@vercel/blob/client`, which POSTs here; `handleUpload` returns a short-lived **scoped** token. The client never sees `BLOB_READ_WRITE_TOKEN`.
- Rate-limited per `clientKey(req)` (`uploadTokenLimiter`) → `429` with `Retry-After`.
- `onBeforeGenerateToken` validates and throws (→ `400`) unless: `pathname` starts with `uploads/`; `clientPayload.siteId` is present and the site is **active**. It then scopes the token: `allowedContentTypes` = png/jpeg/jpg/webp/heic, `addRandomSuffix: true`, `maximumSizeInBytes` = **15 MB**, `tokenPayload = {siteId}`.
- **Anonymous uploads are allowed** because `/submit` is public — the site-active check is the gate. No DB row is written on upload; the resulting URLs land in the `FormSubmission` payload when the form is submitted (orphans are swept by the cron).
- Consumers of `upload()`: `submit/_components/SignaturePad.tsx`, `submit/_components/PhotoGrid.tsx`, `duty/[token]/CameraCapture.tsx`, `sites/_components/SiteForm.tsx`, `key-sets/[id]/_components/KeySetForm.tsx`.

**Retention — `GET /api/cron/blob-cleanup`** (cron-authed, 03:00 UTC in `vercel.json`):
- Paginates `list({prefix:"uploads/", limit:1000})`, collects blobs whose `uploadedAt` is older than **180 days**, and `del()`s them in chunks of 1000.
- Submissions that referenced deleted blobs **keep the dead URL** — a broken image is the intended signal that the media has been retired. See `13-crons.md`.

### Command-palette search (`GET /api/search?q=`)

- Auth: `getSessionUser` (signed-in). Requires `q.length ≥ 2`, else returns empty arrays. Up to `MAX_PER_KIND = 5` hits each.
- **Role-aware**: everyone can search **sites** (name / code / space-stripped postcode / `partnerReference`). Only staff (`ADMIN` / `DISPATCHER`) additionally get **officers** (name / email / `siaNumber`), **live jobs** (active statuses; site / customer / partner / notes), and **open shifts** (`PENDING`/`IN_PROGRESS`; by site). Officers cannot enumerate staff or jobs.
- Consumer: `src/components/CommandPalette.tsx`.

### Officer live-location (`POST /api/officers/me/location`)

- Auth: signed-in. Body validated by zod `{lat, lng, accuracy?}`.
- **Idempotent overwrite** of `User.lastLat` / `lastLng` / `lastSeenAt` — *current position only, no breadcrumb history*.
- Posted every few minutes from `m/today/_components/OnDutyBanner.tsx` while on duty (foreground only — browsers throttle/kill background GPS).
- **Note**: this is separate from the Telegram per-job location stamp (`Job.lat/lng/locatedAt`), which is a one-off share — see `11-telegram-bot.md`.

### Map (brief)

`MapInner.tsx` is a `react-leaflet` map, rendered **client-only** (`dynamic(() => import(...), {ssr:false})` in `DispatchMap.tsx` and `SitesMap.tsx`). Tiles come from the public OpenStreetMap server (no key, attribution rendered). It draws freshness-coloured officer pins (`divIcon`), site `CircleMarker`s (owner colour → live-job → neutral fallback), and dashed assignment polylines, with `FitBounds` auto-framing. Popups link to `/sites/[id]/edit` and Google Maps. It consumes `Site.lat/lng` and `User.lastLat/lastLng`.

## Business rules & invariants

- **Every webhook fails closed** without its secret (`bonlineSecretOk`, `isAuthorisedCron`).
- **`CallEvent` de-dups on `(provider, externalId)`**; the raw `payload` is stored on every delivery, even unparseable ones.
- **Missed detection never guesses** — absent a clear signal it defaults to *not missed*, so dispatch is never falsely alerted.
- **Missed-call alerts fire once** (the `alerted` flag); SMS and Telegram are independent channels.
- **Upload constraints are server-enforced** (pathname prefix, active site, content type, 15 MB) and the client holds no write token.
- **Blob retention is 180 days**; deletion intentionally leaves dangling URLs in submissions.
- **Search is role-scoped**; officers see sites only.
- **Officer location is current-only** (privacy) and foreground-only (browser limits).

## Entry points

| Entry | Auth |
|---|---|
| `GET/POST /api/webhooks/bonline` (`?key=` / `x-webhook-secret`) | `BONLINE_WEBHOOK_SECRET` (POST); GET open. |
| `GET/POST /api/webhooks/bonline/[secret]` | Path secret. |
| `POST /api/blob/upload-token` | Rate-limit + site-active check (anonymous allowed). |
| `GET /api/cron/blob-cleanup` | `Bearer CRON_SECRET`. |
| `GET /api/search?q=` | Signed-in; role-scoped. |
| `POST /api/officers/me/location` | Signed-in. |
| `geocodeSitesMissingCoords` / `geocodePostcodes` | Invoked from admin imports, site save, bulk import — not an HTTP route. |

## Extension points & gotchas

- **The bOnline parser is intentionally loose.** Once real payloads are captured (they're retained in `CallEvent.payload`), tighten `pick()` key lists and `MISSED_RE` in `bonline.ts` — that's the design's whole point.
- **Secret compare is plain `===`** (`bonlineSecretOk`), not constant-time (the code says "constant-ish"). Fine for a shared bearer secret; harden if threat model changes.
- **postcodes.io swallows errors** — a failed/unreachable lookup silently leaves a site without coordinates; inspect the returned `failures[]` to find them.
- **There is no what3words *geocoding*.** `Site.what3words` is a stored free-text field, displayed with a `///` prefix (site pages, job page, the Telegram site lookup) but **never resolved to coordinates** — only postcodes are geocoded. Don't wire the map to it expecting lat/lng.
- **Blob cleanup is destructive and not dry-run-able**; `RETENTION_DAYS` is hard-coded at 180 in the route.
- **Cron auth is open in non-production** (`isAuthorisedCron` returns true when `CRON_SECRET` is unset and `NODE_ENV !== "production"`) — a dev convenience; ensure `CRON_SECRET` is set in prod.
- **The map is client-only** and uses the public OSM tile server (rate limits + attribution). Swap the `TileLayer` `url` for a keyed provider (Mapbox/MapTiler) before heavy use.
- **Cross-references**: `10-notifications.md` (the missed-call SMS/WhatsApp/Telegram fan-out and `queueSmsOnce`), `13-crons.md` (`blob-cleanup`, `sms-queue`), `11-telegram-bot.md` (Telegram missed-call broadcast + the per-job location stamp).

### Env vars

| Var | Integration |
|---|---|
| `BONLINE_WEBHOOK_SECRET` | bOnline webhook auth (both URL shapes). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (server-side only; Vercel-managed). |
| `CRON_SECRET` | `blob-cleanup` (and all cron) auth. |
| *(none)* | postcodes.io geocoding; OpenStreetMap tiles. |
| *SMS/WhatsApp provider vars* | Missed-call fan-out — see `10-notifications.md`. |
