# Sites, Customers & Regions

> The central site registry — the "single source of truth" for every location 1NW covers — plus the direct-customer and region reference data that sites hang off, and the CSV import / postcode-geocoding pipeline that populates them.

## Purpose & scope

- **`Site`** is the hub model of the whole platform: keys, schedules, alarms, jobs, submissions, shifts and rates all reference it. This doc covers the site CRUD surface, the ownership model (customer vs partner), site metadata, and the access-code sub-record.
- **`Customer`** = a *direct* customer (Shurgard, Aegis, Orbis). Owns sites, jobs, default rate cards and contacts.
- **`Region`** = an operating area used to group sites and officers and drive the rota.
- **`AccessInstruction`** = 1:1 side-table on a site holding alarm/padlock codes (encrypted at rest) and entry steps. The alarm-code half is edited here; the padlock-code half overlaps with keys — see `04-keys.md`.
- **Import + geocoding**: the generic sites CSV importer (`sitesImport.ts`), the Nexus-specific importer (`nexusImport.ts`), and postcode → lat/lng backfill (`geocode.ts`).
- Partner-as-customer / partner-as-subcontractor semantics are summarised here but owned by the partners doc. Rates are summarised here but owned by `09-finance-billing-pay.md`.

## Data model

Real definitions in `prisma/schema.prisma`. All string IDs are `@db.Uuid` `gen_random_uuid()`; `Region.id` is an `Int` autoincrement.

### `Site` (the hub)

| Field | Type | Notes |
|---|---|---|
| `id` | Uuid PK | |
| `code` | `String?` **@unique** | Optional internal reference. Uniqueness is the primary import match key. Name is **not** unique. |
| `name` | `String` | Required. |
| `addressLine` | `String` | Required. |
| `postcode` | `String` | Normalised (no spaces, uppercase) — the geocode/match key. |
| `postcodeFormatted` | `String` | Display form (`SW1A 1AA`). |
| `city` | `String?` | |
| `lat` / `lng` | `Float?` | Filled by geocoding; nullable when unresolved. |
| `geofenceRadiusM` | `Int?` | Per-site geofence override; null → app default (300 m). Consumed by shifts, not sites UI. |
| `type` | `SiteType` = `COMMERCIAL` | enum below. |
| `regionId` | `Int?` → `Region` | |
| `customerId` | `Uuid?` → `Customer` | Direct-customer ownership. |
| `partnerId` | `Uuid?` → `Partner` (`"PartnerSites"`) | Partner-as-customer ownership. **`customerId` and `partnerId` are meant to be mutually exclusive but this is NOT enforced** (see invariants). |
| `defaultResponderId` | `Uuid?` → `User` (`"DefaultResponder"`) | Not exposed in the site form. |
| `services` | `ServiceTag[]` = `[]` | Postgres array; drives which conditional form sections appear and which relations sync. |
| `riskLevel` | `RiskLevel` = `LOW` | |
| `notes` | `String?` | Officer-visible. |
| `active` | `Boolean` = `true` | Soft-delete flag; there is **no hard delete**. All list/geocode/export queries filter `active: true`. |
| **Partner metadata** | | Populated by the Nexus importer / editable by hand: |
| `partnerReference` | `String?` (indexed) | Nexus site reference; secondary import match key. |
| `partnerSin`, `sapRef`, `opsUnit`, `what3words`, `partnerStatus` | `String?` | Partner-supplied identifiers. |
| `startDate`, `terminationDate` | `DateTime?` | Contractual dates (also shown on the finance tab). |
| `dne` | `Boolean` = `false` | "Do Not Engage" flag → red chip. |
| `hsMarkers` | `Boolean` = `false` | Health & safety hazards on site → amber chip. |
| `createdAt` / `updatedAt` | | |

Relations owned/heavily used: `keys Key[]`, `keySets KeySet[]`, `accessInstruction AccessInstruction?` (1:1), `patrolSchedules`, `lockUnlockSchedules`, `alarmEvents`, `onboardingPipelines`, `jobs`, `formSubmissions`, `formTemplates`, `rates SiteRate[]`, `shifts`. Indexes on `regionId`, `customerId`, `partnerId`, `postcode`, `type`, `active`, `partnerReference`.

### `Customer`

| Field | Type | Notes |
|---|---|---|
| `id` | Uuid PK | |
| `name` | `String` **@unique** | |
| `type` | `CustomerType` = `CORPORATE` | |
| `contactName` / `contactEmail` / `contactPhone` | `String?` | **Legacy** single-contact fields. Superseded by `CustomerContact[]` but still read as a fallback in the site sidebar. |
| `billingAddress`, `contractRef` | `String?` | |
| `contractStart` / `contractEnd` | `DateTime?` | |
| `notes` | `String?` | |
| `smsAlertsOn` | `Boolean` = `false` | Opt-in for alarm SMS acks (used by notifications, not this module). |
| `active` | `Boolean` = `true` | |

Relations: `sites`, `jobs`, `contacts CustomerContact[]`, `formTemplates`, `rates CustomerRate[]`.

### `CustomerContact`

`customerId` (→ Customer, `onDelete: Cascade`), `name` (required), and optional `role`, `email`, `phone`, `ref`, `notes`. No uniqueness. This is the current multi-contact model; the customer form manages these rows.

### `Region`

`id Int PK`, `name String @unique`, `leadUserId Uuid?` → `User` (`"RegionLead"` — **not managed by the regions admin UI**), `notes String?`. Relations: `sites`, `officers User[]` (`"OfficerRegion"`), `rotaAssignments`.

### `AccessInstruction` (1:1 with Site)

| Field | Type | Notes |
|---|---|---|
| `siteId` | `Uuid` **@unique** (→ Site, Cascade) | |
| `alarmCodeEnc` | `Bytes?` | AES-256-GCM ciphertext (see `crypto.ts`). |
| `padlockCodeEnc` | `Bytes?` | AES-256-GCM ciphertext. |
| `alarmCode` / `padlockCode` | `String?` | **Legacy plaintext** columns. Written as `null` on every save; read only as a fallback for un-migrated rows. |
| `entryStepsMd` | `String?` | Free text / markdown. |
| `lockboxId` | `String?` | |
| `hazards` | `String?` | |
| `updatedAt`, `updatedBy` | | `updatedBy` is not currently populated by the site form. |

### Enums

- **`SiteType`**: `COMMERCIAL | RESIDENTIAL | RETAIL | STORAGE | INDUSTRIAL | OTHER`
- **`ServiceTag`**: `ALARM_RESPONSE | KEYHOLDING | LOCKUP | UNLOCK | VPI | PATROL | STATIC_GUARDING | DOG_HANDLER | ADHOC`
- **`RiskLevel`**: `LOW | MEDIUM | HIGH`
- **`CustomerType`**: `CORPORATE | RESIDENTIAL | RESELLER`
- **`CustomerProgram`**: `TESCO | SHURGARD | OTHER` (used by `OnboardingPipeline`, not by Customer/Site directly)

## Key files

- `prisma/schema.prisma` — models `Region`, `Customer`, `CustomerContact`, `Site`, `AccessInstruction`; the enums above.
- `src/app/(app)/sites/page.tsx` — sites list: search/filter, KPI strip, map, paginated table (`PAGE_SIZE = 50`), CSV export link. `force-dynamic`.
- `src/app/(app)/sites/_actions.ts` — `createSite`, `updateSite`, `bulkUpdateSites`; the Zod schema and `syncRelations` transaction that fans a single form out to keys/schedules/access. **This is the heart of the module.**
- `src/app/(app)/sites/_components/SiteForm.tsx` — the one big client form (basics, ownership, partner metadata, services, and service-gated sections for keys / lock-unlock / patrol / VPI / access). Serialises keys+schedules to hidden JSON inputs.
- `src/app/(app)/sites/_components/SitesTable.tsx` — table + client-side multi-select + `BulkActionBar` (bulk assign customer/partner/region).
- `src/app/(app)/sites/_components/SitesToolbar.tsx`, `SitesMap.tsx`, `PatrolTimesEditor.tsx` — filter bar, Leaflet map wrapper, per-day patrol-time editor.
- `src/app/(app)/sites/new/page.tsx` — new-site page; loads region/customer/partner/officer lookups, renders `SiteForm` with empty `initial`.
- `src/app/(app)/sites/[id]/page.tsx` — site detail with tabs (overview / schedule / keys / finance [admin] / activity / documents / settings).
- `src/app/(app)/sites/[id]/edit/page.tsx` — edit page; projects DB rows back into `SiteForm` initial values and **decrypts** access codes for display.
- `src/app/(app)/sites/[id]/_actions.ts` — `upsertSiteRate` / `deleteSiteRate` (finance tab; admin-only).
- `src/app/(app)/sites/[id]/_lib/activity.ts` — `loadActivity()`: merges AlarmEvent + PatrolVisit + FormSubmission + Job into a unified reverse-chron feed.
- `src/app/(app)/sites/[id]/_components/` — `SiteHeader`, `Tabs`, `ActivityFeed`, `SiteRatesEditor`.
- `src/app/(app)/admin/customers/**` — customer list (`page.tsx`), `new`, `[id]/edit`, `_actions.ts`, `_components/CustomerForm.tsx`, and `[id]/rates/` (customer default rate card).
- `src/app/(app)/admin/regions/**` — `page.tsx`, `_actions.ts`, `_components/RegionsManager.tsx` (inline add/edit/delete).
- `src/app/(app)/admin/imports/sites/**` — CSV import + geocode admin surface (`page.tsx`, `_actions.ts`, `_components/SitesImportPanel.tsx`, `GeocodePanel.tsx`).
- `src/app/(app)/admin/imports/nexus/**` — Nexus-specific importer UI (partner rate columns).
- `src/lib/sitesImport.ts` — generic CSV parse / preview / apply.
- `src/lib/nexusImport.ts` — Nexus CSV helpers (`readCsvRows`, `normalisePostcode`, `formatPostcode`, `parseAddress`, `parseAmount`…) + `previewNexusImport` / `runNexusImport`.
- `src/lib/geocode.ts` — `geocodePostcodes()` (postcodes.io bulk) + `geocodeSitesMissingCoords()` backfill.
- `src/lib/crypto.ts` — AES-256-GCM `encryptString` / `decryptString` for access codes.
- `src/lib/entityColor.ts` — `entityColor()` / `siteOwner()` stable brand colours for map pins/chips.
- `src/app/api/sites/export/route.ts` — GET CSV export (ADMIN/DISPATCHER).
- `src/app/api/blob/upload-token/route.ts` — issues scoped Vercel Blob tokens for key-set photos (validates `siteId` is active).
- `src/lib/authz.ts` — `requireStaff` (ADMIN|DISPATCHER), `requireAdmin`, `getSessionUser`.

## Core flows

### 1. Create a site (`createSite`, `sites/_actions.ts`)
1. `requireStaff()` gates the action (ADMIN or DISPATCHER).
2. `parseFormData(formData)` pulls scalar fields plus three hidden JSON blobs — `keysets_json`, `patrol_days_json`, `vpi_days_json` — and the `access_*` / `lockunlock_*` fields, then `SiteInput.safeParse` (Zod) validates. On failure returns `{ error, fieldErrors }` (no throw).
3. If `code` set, uniqueness pre-check against `Site.code`.
4. `geocodeOne(postcode)` — best-effort single-postcode lookup (never blocks; returns `null` on any failure).
5. `prisma.site.create` with normalised postcode (`normalisePostcode`) + `postcodeFormatted` (`formatPostcode`) + coords.
6. `syncRelations(created.id, d)` (see flow 3).
7. `revalidatePath("/sites")` then `redirect("/sites/{id}")`.

### 2. Update a site (`updateSite`)
Same as create except: uniqueness check excludes `self` (`NOT: { id }`); geocode runs **only** when the postcode changed *or* existing `lat`/`lng` is null (`needsGeocode`); coords are only overwritten when a fresh fix was obtained (a failed lookup never wipes good coordinates). Redirects to `/sites/{id}`.

### 3. Fan-out to related records (`syncRelations`, one `$transaction`)
Reads `d.services` and gates each block. This is the load-bearing, non-obvious logic:
- **Keys** (`if KEYHOLDING`): iterate `d.keySets`. Existing set + `remove` → soft-retire (`keySet.active=false`, its keys `status=RETIRED`). Existing set → update. New set → create. Then per key: existing → update (or `RETIRED` if `remove`); new & not removed → create under the set. Keys created here always get `siteId` + `keySetId`.
- **Lock/unlock** (`if LOCKUP || UNLOCK`): upsert the single `LockUnlockSchedule`; if neither service is set, the existing schedule is soft-deactivated (`active=false`).
- **Patrol** (`if PATROL`): `deleteMany({ siteId, kind: PATROL })` **then** recreate from `d.patrolDays`. Schedules are destroyed and rebuilt on every save (see gotchas).
- **VPI** (`if VPI`): same delete-and-recreate against `kind: VPI`.
- **Access** (`if ALARM_RESPONSE`): upsert `AccessInstruction` with `alarmCodeEnc/padlockCodeEnc = encryptString(...)` and the plaintext columns forced to `null`.

`scheduleRowFromInput` maps a form day into a `PatrolSchedule` row: prefers `times[]`, falls back to legacy `timeOfDay`, keeps `timeOfDay = times[0]`; **partner assignment wins over officer** (mutually exclusive); `partnerFillsOwnApp` only meaningful when a partner is set.

### 4. Edit-page projection (`sites/[id]/edit/page.tsx`)
Loads the site with active key sets (non-retired keys), **orphan keys** (`keySetId: null`), active schedules and `accessInstruction`. Maps schedules back with `timesOfDay || [timeOfDay]`. Orphan keys are folded into a synthetic `"Site keys"` set so they survive the next save. Access codes shown via `decryptString(alarmCodeEnc) ?? alarmCode ?? null`.

### 5. Bulk re-assign (`bulkUpdateSites` + `SitesTable`/`BulkActionBar`)
Client selects rows; the sticky bar offers customer/partner/region dropdowns each with `— don't change —` (undefined) / `— clear —` (null) / a value. `bulkUpdateSites` (`requireStaff`) validates with `BulkInput` (≤500 ids), builds a sparse `data` object (only defined keys), and runs one `updateMany`. Rejects if nothing to change.

### 6. Detail page + activity feed
`sites/[id]/page.tsx` fetches the site with customer(+contacts+rates), partner, region, keys, active key sets, schedules, access, rates; computes key counts + summary chips. `loadActivity(siteId, {take})` (`_lib/activity.ts`) fans out four queries (alarms/patrols/submissions/jobs, each `take = take+skip+20`), maps to a common `ActivityEvent` shape with per-source severity/href, merges, sorts desc, slices. `total` is the sum of four `count()`s. Finance tab is admin-only (falls back to overview for others).

### 7. Customer create/update (`admin/customers/_actions.ts`)
`requireAdmin` → `CustomerInput.safeParse` → name-uniqueness check → `customer.create/update` → `syncContacts` (a `$transaction` that creates/updates/deletes `CustomerContact` rows by `id` + `remove`). Dates via `toDate` (invalid → null). Create redirects to `/…/edit`; update redirects to the list.

### 8. Region CRUD (`admin/regions/_actions.ts` + `RegionsManager`)
Inline table UI. `createRegion`/`updateRegion` (`requireAdmin`, name-unique). `deleteRegion` refuses if any site references the region (`site.count({ regionId }) > 0`) — the Delete button is also disabled client-side when `siteCount > 0`.

### 9. CSV import (`sitesImport.ts` via `admin/imports/sites`)
Two server actions, **both re-parse the uploaded file independently** — preview is advisory only:
1. `previewSites(formData)` → `previewSitesImport(prisma, csvText)`: parse rows (`readCsvRows`), classify CREATE vs UPDATE, resolve customer/partner/region tags, collect warnings, return counts + a ≤25-row sample. No writes.
2. `commitSites(formData)` → `runSitesImport`: create any missing regions up-front; per row resolve `customerId`/`partnerId`/`regionId`, then match existing by `code` (unique) else by `name + postcode`, and `update` or `create`. **Tags are only ever set, never nulled** (`...(customerId ? { customerId } : {})`). Finally best-effort `geocodeSitesMissingCoords` (failure is swallowed, never rolls back).

Matching rules & auto-tagging (`sitesImport.ts`):
- Required columns: `name`, `postcode`. Optional: `code`, `addressLine`, `type`, `region`, `services`, `notes`, `customer`, `partner`, `lat`, `lng` (many header aliases accepted via `pick`).
- Auto-customer by **name prefix**: `shurgard ` → Shurgard, `aegis ` → Aegis, `orbis ` → Orbis (only if no explicit `customer` column).
- Auto-partner by **code prefix**: `NEX*` → Nexus Security.
- Unknown `type` → `COMMERCIAL` + warning; unknown services dropped + warning; a customer/partner name that doesn't resolve → left untagged + warning.

### 10. Geocoding (`geocode.ts`)
- `geocodePostcodes(codes)`: dedups + normalises, POSTs to `https://api.postcodes.io/postcodes` in batches of 100, returns a `Map` keyed by normalised postcode. All network/JSON errors are swallowed per-batch (`continue`). Unresolved postcodes are simply absent.
- `geocodeSitesMissingCoords(prisma, {force?})`: selects sites with a postcode and (unless `force`) missing `lat`/`lng`, writes coords back one-by-one, returns `{scanned, geocoded, failed, failures[]}`. `GeocodePanel` exposes both "geocode missing" and "re-geocode all" (`regeocodeAllSites` = `force: true`).

### 11. CSV export (`api/sites/export/route.ts`)
GET, role-gated to ADMIN|DISPATCHER (`getServerSession`). Re-implements the list `where` (same q/region/service/type filters, `active: true`), emits `code,name,address,postcode,city,type,region,customer,partner,services(|-joined),risk_level,onboarding_stage,notes` with RFC-4180-ish `csvEscape`. Filename `sites-YYYY-MM-DD.csv`, `cache-control: no-store`.

## Business rules & invariants

A rebuild must preserve:
- **Site is never hard-deleted.** `active=false` is the only removal. Every list/map/export/geocode query assumes `active: true`.
- **`code` is the primary identity** for imports/dedup and is unique; `name` is not unique. Import falls back to `name + postcode` when `code` is absent.
- **Ownership is customer XOR partner by convention only.** Neither the DB, the Zod schema, `bulkUpdateSites`, nor `SiteForm` prevents setting both. The form copy says "not both"; `siteOwner()` resolves display precedence as **partner > customer** when both are set. A rebuild should decide whether to enforce this.
- **Services drive everything.** The presence of a `ServiceTag` gates which form sections render *and* which relations `syncRelations` touches. Un-ticking a service does **not** uniformly clean up: patrol/VPI schedules are hard-deleted; lock/unlock is soft-deactivated; **keys and AccessInstruction are left intact/orphaned** (no `else` branch). This asymmetry is deliberate-ish but surprising.
- **Patrol & VPI schedules are delete-and-recreated on every save** (`deleteMany` then `createMany`). Any FK'd data keyed on a `PatrolSchedule.id` will be broken by an edit — `PatrolVisit.patrolScheduleId` is nullable/`SetNull`-ish precisely because of this.
- **Access codes are encrypted at rest.** Writes always set `*Enc` (AES-256-GCM) and null the legacy plaintext columns. `ENCRYPTION_KEY` (base64, 32 bytes) must be set or **writes throw** ("refusing to write sensitive data unencrypted"). Reads tolerate legacy plaintext and return `null` on GCM auth failure rather than leaking ciphertext.
- **Postcodes are stored twice**: `postcode` (normalised, the match/geocode key) and `postcodeFormatted` (display). Keep them in sync via `normalisePostcode`/`formatPostcode`.
- **Geocoding never blocks a write.** Create always attempts it; update only when needed; import does it best-effort at the end; failures never roll back or wipe existing coords.
- **Import only adds tags, never clears them** — re-importing a CSV without a `customer`/`partner` column won't un-tag already-tagged sites.
- **Region delete is blocked while sites reference it.**
- Customer legacy `contactName/Email/Phone` still surface in the site sidebar when a customer has zero `CustomerContact` rows — don't drop those columns blindly.

## Entry points

**Server actions**
- `sites/_actions.ts`: `createSite`, `updateSite(id, …)`, `bulkUpdateSites({ids, customerId?, partnerId?, regionId?})`.
- `sites/[id]/_actions.ts`: `upsertSiteRate(siteId, …)`, `deleteSiteRate(id)` — admin-only; per-site rate overrides (finance → `09-finance-billing-pay.md`).
- `admin/customers/_actions.ts`: `createCustomer`, `updateCustomer(id, …)`.
- `admin/customers/[id]/rates/_actions.ts`: `upsertCustomerRate(customerId, …)`, `deleteCustomerRate(id)` — customer default rate card.
- `admin/regions/_actions.ts`: `createRegion`, `updateRegion(id, …)`, `deleteRegion(id)`.
- `admin/imports/sites/_actions.ts`: `previewSites`, `commitSites`, `geocodeMissingSites`, `regeocodeAllSites`, `countSitesMissingCoords`, `countSitesWithPostcode` (all `requireAdmin`).
- `admin/imports/nexus/_actions.ts`: Nexus preview/commit/reset.

**API routes**
- `GET /api/sites/export` — filtered CSV (ADMIN|DISPATCHER).
- `POST /api/blob/upload-token` — scoped Vercel Blob token for key-set photos; validates `siteId` exists & is active, content type ∈ image/*, ≤15 MB, pathname under `uploads/`. Rate-limited. Anonymous uploads allowed (the public `/submit` page shares this route).

**Crons** — none owned by this module. Geocoding is admin-triggered, not scheduled.

## Extension points & gotchas

- **No standalone site delete.** If a rebuild needs real deletes, note the wide fan-out of relations (keys, schedules, alarms, jobs, submissions, shifts, rates) and the many `onDelete` policies — several are the default `Restrict`.
- **The single `SiteForm` is doing a lot.** It owns keys, key-set photos, lock/unlock, multi-time patrol/VPI schedules with per-day officer/partner/interval/exception-date controls, and access codes — all serialised through three hidden JSON inputs (`keysets_json`, `patrol_days_json`, `vpi_days_json`). New per-site config tends to get bolted on here.
- **Access section UI copy is stale**: `AccessSection` still says *"Stored plaintext for now — encryption coming"*, but `syncRelations` already encrypts. Don't trust the copy; trust `crypto.ts`.
- **Key-set photo upload needs a saved site.** `SetPhotoField` disables upload when `initial.id` is null (no UUID yet) because the blob token route requires an existing active `siteId`. New sites must be saved before photos can be attached (also handled per-set on `/key-sets/[id]`).
- **Preview and commit re-parse independently.** The import UI (`SitesImportPanel`) keeps the file in a ref and sends it to both actions; the preview counts are advisory. Editing the file between preview and commit silently changes what gets written.
- **`runSitesImport` does N sequential round-trips** (per-row find + create/update, plus per-region create). Fine for the ~485-row seed, but not batched — a rebuild handling larger lists should chunk/`createMany`.
- **Nexus import is a separate path** (`nexusImport.ts`) with its own address parser (`parseAddress` splits city/postcode out of one address string) and rate-column mapping (`RATE_COLUMNS`). It writes `SiteRate` rows and requires the `Nexus Security` partner to exist first. Keep it and the generic importer from drifting.
- **`entityColor`/`siteOwner`** give brands stable colours by first-name-word hash, with named overrides (Shurgard red, Nexus blue, Keyholding orange, Orbis green, Aegis violet). Add to `NAMED` for a new brand colour; everything else picks it up automatically.
- **`Region.leadUserId` and `Site.defaultResponderId`** exist in the schema but have no editing UI here.
- Notifications for site/customer changes: none. Key handovers do notify — see `10-notifications.md`.
