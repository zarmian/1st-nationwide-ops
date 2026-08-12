# Keys & Key Sets

> Physical-key inventory and chain-of-custody: every key/fob/padlock/code 1NW holds, grouped into per-site sets, with an append-only movement log and a WhatsApp handover notification on each transfer.

## Purpose & scope

- Tracks the physical **keys** 1NW holds for keyholding/alarm-response sites, who currently holds each one, and its full handover history.
- Groups keys into **key sets** (a physical bunch — e.g. `NT01` = 2 keys + 1 fob + padlock) with a reference photo so officers recognise the bunch on arrival.
- Records every transfer as an immutable **`KeyMovement`** (from → to, signed off by, reason) — the chain of custody.
- Covers the keys/key-sets browse + handover + edit surface, and the single-key and whole-set handover paths.
- **Access codes** (alarm/padlock) live on `AccessInstruction`, which is edited from the *site* form, not here — see `03-sites-customers-regions.md`. This doc notes the padlock-code relationship but does not re-document encryption in depth.
- The handover notification (`notifyKeyHandover`) is summarised here; the delivery pipeline is owned by `10-notifications.md`.

## Data model

Real definitions in `prisma/schema.prisma`. All IDs are `@db.Uuid` `gen_random_uuid()`.

### `KeySet`

| Field | Type | Notes |
|---|---|---|
| `id` | Uuid PK | |
| `siteId` | `Uuid` (→ Site, `onDelete: Cascade`) | A set always belongs to one site. |
| `internalNo` | `String?` **@unique** | Human ref (e.g. `NT01`). Unique across all sets. |
| `label` | `String` | Required. |
| `notes` | `String?` | |
| `photoUrl` | `String?` | Vercel Blob URL of the physical bunch. |
| `active` | `Boolean` = `true` | Soft-retire flag. |
| `createdAt` / `updatedAt` | | |

Relation: `keys Key[]`. Indexed on `siteId`.

### `Key`

| Field | Type | Notes |
|---|---|---|
| `id` | Uuid PK | |
| `internalNo` | `String?` **@unique** | |
| `label` | `String` | Required. |
| `type` | `KeyType` | enum below. |
| `siteId` | `Uuid?` (→ Site) | **Nullable** — a key can exist without a site. No explicit `onDelete` (default `Restrict`). |
| `keySetId` | `Uuid?` (→ KeySet, `onDelete: SetNull`) | **Nullable** — "loose"/orphan keys have none. Deleting a set nulls this, keeping the key. |
| `copyOfId` | `Uuid?` → `Key` (`"KeyCopies"`, `SetNull`) | Self-relation for duplicate keys. |
| `copies` | `Key[]` (`"KeyCopies"`) | Reverse of `copyOf`. |
| `duplicable` | `Boolean` = `true` | "We can have copies cut." |
| `currentHolderUserId` | `Uuid?` → `User` (`"KeyHolder"`) | Denormalised pointer to the latest holder; kept in sync with the last `KeyMovement`. |
| `status` | `KeyStatus` = `WITH_US` | enum below. |
| `qrId` | `String?` **@unique** | Intended for QR labelling. **No code generates or scans it** (searchable in the list filter only) — effectively a placeholder. |
| `notes` | `String?` | |

Relation: `movements KeyMovement[]`. Indexes: `siteId`, `keySetId`, `copyOfId`, `currentHolderUserId`, `status`.

### `KeyMovement` (append-only chain of custody)

| Field | Type | Notes |
|---|---|---|
| `id` | Uuid PK | |
| `keyId` | `Uuid` (→ Key, `onDelete: Cascade`) | |
| `fromUserId` | `Uuid?` → `User` (`"KeyMoveFrom"`) | Null = "was with 1NW". |
| `toUserId` | `Uuid?` → `User` (`"KeyMoveTo"`) | Null = "back to 1NW". |
| `occurredAt` | `DateTime` = `now()` | |
| `reason` | `String?` | |
| `notes` | `String?` | Not written by the current handover forms. |
| `signedOffById` | `Uuid?` → `User` (`"KeyMoveSignedOff"`) | The staff member who recorded it. |

Indexed on `[keyId, occurredAt]`. Rows are never updated or deleted by app code — history is immutable.

### `AccessInstruction` (referenced, owned by the sites doc)

1:1 with `Site`. Holds `alarmCodeEnc` / `padlockCodeEnc` (`Bytes?`, AES-256-GCM via `src/lib/crypto.ts`), legacy plaintext `alarmCode`/`padlockCode` (nulled on write), `entryStepsMd`, `lockboxId`, `hazards`. The **padlock code** conceptually pairs with padlock-type keys but is stored here and edited on the site form, not in the keys UI. See `03-sites-customers-regions.md`.

### Enums

- **`KeyType`** (schema): `KEY | FOB | PADLOCK | CODE` — only four values.
  - ⚠️ **Mismatch:** `keys/_actions.ts` (`updateKey`) and `KeyEditForm.tsx` accept a *wider* set — `KEY | PADLOCK | FOB | CARD | CODE | REMOTE | OTHER`. `CARD`, `REMOTE`, `OTHER` are **not** valid Prisma enum members and will throw a DB error if saved. See gotchas.
- **`KeyStatus`**: `WITH_US | WITH_OFFICER | WITH_CUSTOMER | LOST | RETIRED`.

## Key files

- `prisma/schema.prisma` — `KeySet`, `Key`, `KeyMovement`, `AccessInstruction`; enums `KeyType`, `KeyStatus`.
- `src/app/(app)/keys/page.tsx` — global keys list: status KPI cards, search + site/holder filters, `PAGE_SIZE = 100`. Groups keys under their set (expandable) with loose keys as their own rows.
- `src/app/(app)/keys/_components/KeysTable.tsx` — the grouped/expandable table (`SetRow` / `LooseRow`); `summariseSet` collapses a set's types/statuses/holder to one line ("Mixed" when they differ).
- `src/app/(app)/keys/_actions.ts` — **all key server actions**: `handoverKey`, `updateKey`, `updateKeySet`, `handoverKeySet`. (Note: `key-sets/[id]` imports its actions from here.)
- `src/app/(app)/keys/[id]/page.tsx` — single-key detail: movement history table + current holder + handover form + copy-of/copies + notes.
- `src/app/(app)/keys/[id]/_components/HandoverForm.tsx` — single-key handover form (recipient select, reason).
- `src/app/(app)/keys/[id]/edit/page.tsx` + `_components/KeyEditForm.tsx` — edit label/internalNo/type/status/notes/duplicable.
- `src/app/(app)/key-sets/[id]/page.tsx` — key-set detail: set-details form, "keys in set" table, whole-set handover.
- `src/app/(app)/key-sets/[id]/_components/KeySetForm.tsx` — set label/internalNo/notes/photo (Vercel Blob upload).
- `src/app/(app)/key-sets/[id]/_components/KeySetHandoverForm.tsx` — whole-set handover form.
- `src/lib/notifications.ts` → `notifyKeyHandover(movementId)` — queues WhatsApp `KEY_HANDOVER` messages (summarised below; details in `10-notifications.md`).
- `src/lib/crypto.ts` — AES-256-GCM used by access codes (padlock code).
- `src/lib/authz.ts` — `requireStaff()` guards every key mutation.
- **Key/key-set creation lives elsewhere:** `src/app/(app)/sites/_actions.ts` `syncRelations` is the *only* path that creates keys and key sets (via the site form's Keys section). See `03-sites-customers-regions.md`.

## Core flows

### 1. Browse keys (`keys/page.tsx`)
1. Build a Prisma `where` from `q` (matches `label`/`internalNo`/`qrId`/`site.name`), `status`, `site`, `holder` (`holder=none` → `currentHolderUserId: null`).
2. Parallel: paginated `key.findMany` (include site, currentHolder, keySet), active sites, staff holders (OFFICER/DISPATCHER/ADMIN), `groupBy status` counts, total count.
3. **Group into rows client-side**: keys with a `keySet` collapse into one `SetRow` (first occurrence creates it; later keys push into it); loose keys become `LooseRow`. Status KPI cards link to `?status=…`.

### 2. Single-key handover (`handoverKey`, `keys/_actions.ts`)
1. `requireStaff()` → `me.id` becomes `signedOffById`.
2. Parse `{ toUserId, reason }` (`HandoverInput`); empty/absent `toUserId` → `null` ("back to us").
3. Load the key's `currentHolderUserId`.
4. **Create a `KeyMovement`**: `fromUserId = key.currentHolderUserId`, `toUserId`, `reason`, `signedOffById`.
5. **Update the key**: `currentHolderUserId = toUserId`, `status = toUserId ? WITH_OFFICER : WITH_US`.
6. `notifyKeyHandover(movement.id)` — **fire-and-forget** (`.catch(console.error)`; failure never blocks the handover).
7. `revalidatePath` `/keys/{id}` and `/keys`; return `{ ok: true }`.

Note: handover can only set `WITH_OFFICER` or `WITH_US`. `WITH_CUSTOMER`, `LOST`, `RETIRED` are only reachable via `updateKey`.

### 3. Whole-set handover (`handoverKeySet`)
1. `requireStaff()`; parse the same `{ toUserId, reason }`.
2. Load **all** keys in the set (`keySetId: setId`); error if empty.
3. In one `$transaction`, loop every key: create its own `KeyMovement` (per-key `fromUserId` preserved) and update `currentHolderUserId`/`status`. Chain-of-custody stays per-key — this only skips the per-key click-through.
4. After commit, fire `notifyKeyHandover` **per movement** (each fire-and-forget).
5. Revalidate `/key-sets/{id}` and `/keys`.

### 4. Edit a key (`updateKey`) / set (`updateKeySet`)
- `updateKey`: `requireStaff` → `KeyUpdateInput` Zod parse → `key.update` of label/internalNo/type/status/notes/duplicable. **The type/status enums here are wider than the DB enum** (see gotchas).
- `updateKeySet`: `requireStaff` → `KeySetUpdateInput` → update label/internalNo/notes/photoUrl. `photoUrl` accepts a URL or empty string (→ null).

### 5. Key-set detail (`key-sets/[id]/page.tsx`)
Loads the set with site + keys (id/internalNo/label/type/status/currentHolder). Computes a single-holder-vs-mixed summary: `currentHolderId` is non-null only when all keys share one holder; `holderMixed` when they differ (shows an amber warning that the handover applies to every key). Renders `KeySetForm`, the keys table (each key links to `/keys/{id}`), and `KeySetHandoverForm`.

### 6. Key-set photo upload (`KeySetForm` / `SetPhotoField`)
Client calls `upload()` from `@vercel/blob/client` against `POST /api/blob/upload-token` with `clientPayload = { siteId }`. The route validates the site is active, restricts to image content types, ≤15 MB, pathname under `uploads/`, and returns a scoped token; the resulting URL is saved to `KeySet.photoUrl` via `updateKeySet`. The same route/flow is shared by the site form's per-set photo field and the public `/submit` photo grid.

### 7. Handover notification (`notifyKeyHandover`, `notifications.ts`)
Given a `movementId`: loads the movement (+key label/internalNo, from/to user names), builds a label like `NT01 (Front door)`, then queues WhatsApp `KEY_HANDOVER` messages to a **deduped** recipient set = all staff recipients **plus** the from-officer and to-officer. Template `key_handover`, params `[keyLabel, fromLabel, toLabel, occurredAt]`. Returns the count queued. Delivery/retry handled by the WhatsApp queue cron — see `10-notifications.md`.

## Business rules & invariants

A rebuild must preserve:
- **`KeyMovement` is append-only.** Never updated or deleted. `Key.currentHolderUserId` + `Key.status` are the denormalised "current" projection of the latest movement and must be written together with each new movement, in the same logical operation.
- **Handover status mapping is fixed**: recipient set → `WITH_OFFICER`; "back to us" (null) → `WITH_US`. Other statuses (`WITH_CUSTOMER`, `LOST`, `RETIRED`) are edit-only, never set by a handover.
- **Whole-set handover writes one movement per key** — the audit trail is identical to N single handovers; only the UI is batched. Keep it per-key.
- **Keys and key sets are created only through the site form** (`syncRelations`). The `/keys` and `/key-sets` surfaces are read + handover + edit; there is no standalone "new key" action. A rebuild adding direct creation must decide the site/set linkage rules that `syncRelations` currently owns.
- **Loose keys are valid.** `Key.keySetId` and `Key.siteId` are both nullable. The site edit page folds orphan (`keySetId: null`) keys into a synthetic "Site keys" set on load so they aren't lost on the next save — replicate this or enforce set membership.
- **Soft-retire, not delete.** Removing a set in the site form sets `KeySet.active=false` and its keys `status=RETIRED`; retired keys/sets are filtered out of most reads (`status: { not: RETIRED }`, `active: true`). There is no hard key/set delete in the app.
- **`internalNo` is unique on both `Key` and `KeySet`.** Import/creation must avoid collisions.
- **Notifications are fire-and-forget.** A failed `notifyKeyHandover` must never roll back or block the handover write.
- **Handover recipients are staff only** (OFFICER/DISPATCHER/ADMIN) — the recipient dropdowns are populated from those roles; partner officers are not selectable here.

## Entry points

**Server actions** (all in `src/app/(app)/keys/_actions.ts`, all `requireStaff`)
- `handoverKey(keyId, prev, formData)` — single-key transfer + movement + notify.
- `handoverKeySet(setId, prev, formData)` — whole-set transfer (txn) + per-key movements + per-key notify.
- `updateKey(keyId, prev, formData)` — edit key fields.
- `updateKeySet(setId, prev, formData)` — edit set fields incl. photo URL.

**API routes**
- `POST /api/blob/upload-token` — shared upload-token issuer for key-set photos (validates active `siteId`; image types; ≤15 MB). Owned by the sites/blob doc but consumed here.
- No dedicated keys REST API; the browse/detail pages are server components reading Prisma directly.

**Crons** — none owned here. The `KEY_HANDOVER` notification is drained by the WhatsApp queue cron (`10-notifications.md`).

## Extension points & gotchas

- **`KeyType` enum drift (real bug surface).** Schema = `KEY | FOB | PADLOCK | CODE`. `updateKey`'s Zod enum and `KeyEditForm`'s dropdown also offer `CARD`, `REMOTE`, `OTHER`. Selecting one of those three will fail at the Prisma write (invalid enum value). A rebuild should either widen the DB enum (with a migration — see `CLAUDE.md`) or narrow the form/action to the four real values.
- **`qrId` is dead weight today.** Unique column, surfaced only in the list search; nothing generates or scans QR codes. Either wire up QR labelling or drop the field.
- **`copyOf`/`copies` are read-only in the UI.** The key detail page displays the duplicate relationship, but no action sets `copyOfId`. If key-copy tracking matters, add a create-copy flow.
- **Access/padlock codes are not in this module.** They're on `AccessInstruction`, edited from the site form, encrypted via `crypto.ts`. Don't add a second code store here — reference the site's access record.
- **Whole-set handover with mixed holders** applies to *all* keys regardless of their individual current holders (the UI warns). If partial-set handovers are ever needed, they must be done per-key from `/keys/{id}`.
- **`KeyMovement.notes`** exists but is never written by the current forms (only `reason` is). Spare field for a richer audit note.
- **Denormalisation risk:** because `Key.currentHolderUserId`/`status` duplicate the latest movement, any new write path (bulk ops, imports, admin fixes) must update both the movement log and the projection or they'll drift. There is no reconciliation job.
- Key/set mutations `revalidatePath('/keys')` (and the specific detail path) but not the owning site page — a site detail view may show stale key summaries until its own revalidation.
