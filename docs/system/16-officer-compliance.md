# Officer Compliance & Vetting

> A single audit-ready view of every officer's SIA licence, right-to-work, DBS and training certificates — with expiry status and a weekly email alert. For an SIA-regulated firm this is the record that keeps you passing ACS assessments and client contract checks; deploying a lapsed licence fails both.

## Purpose & scope

- Track the **vetting state** of each active officer/dispatcher and flag anything **expired**, **expiring soon** (≤30 days) or **not recorded**, before it becomes a compliance breach.
- Covers: the `User` vetting fields + the `OfficerCertification` model, the `/compliance` register, the compliance fields on the officer edit form, the training-certificate editor, and the weekly `compliance-alerts` cron.
- **Out of scope (cross-referenced):** users, roles and auth → [`02-access-auth-roles.md`](./02-access-auth-roles.md); the cron plumbing → [`13-crons.md`](./13-crons.md); the email transport → [`10-notifications.md`](./10-notifications.md) / `src/lib/email.ts`.

## Data model

Read `prisma/schema.prisma`.

**`User` — vetting fields** (added alongside the existing `siaNumber`):

| Field | Type | Notes |
|---|---|---|
| `siaExpiry` | `DateTime?` | SIA licence expiry. Null → treated as **missing** (a real gap — the critical one). |
| `rightToWorkExpiry` | `DateTime?` | Null → **indefinite** (settled/British), *not* a gap. |
| `dbsCheckedOn` | `DateTime?` | Date DBS was last checked. Null → **missing**; no auto-staleness (policy varies). |
| `certifications` | `OfficerCertification[]` | Back-relation. |

**`OfficerCertification`** — training / qualifications (First Aid, CCTV/PSS, etc.):

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `officerId` → `officer` | required, `onDelete: Cascade` | |
| `name` | `String` | e.g. "First Aid at Work". |
| `issuedOn`, `expiresOn` | `DateTime?` | A cert with no `expiresOn` is treated as **non-expiring**. |
| `reference` | `String?` | Certificate/awarding-body ref. |
| `createdAt` | `DateTime` | |

Indexes on `[officerId]` and `[expiresOn]`. Migration: `prisma/migrations/20260831120000_officer_compliance/`.

## Key files

- `src/lib/compliance.ts` — the engine. `statusFor(date, asOf, warnDays=30)` → `missing | expired | expiring | valid`; `loadComplianceRegister()` builds per-officer items with a worst-of roll-up, headline counts and a worst-first "needs attention" list; `expiringComplianceItems(withinDays)` is the flat, expired-first digest the cron sends. Pure classifier unit-tested in `compliance.test.ts`.
- `src/app/(app)/compliance/page.tsx` — the register (admin): KPI band (expired / expiring / not recorded / all clear), a "needs attention" panel, and the full officer table.
- `src/app/(app)/officers/_components/OfficerForm.tsx` — a "Compliance & vetting" card (the three `User` date fields).
- `src/app/(app)/officers/_components/CertificationsEditor.tsx` — add/remove training certs (client), backed by `addCertificationAction` / `deleteCertificationAction` in `officers/_actions.ts`.
- `src/app/(app)/officers/[id]/edit/page.tsx` — wires the vetting fields + the cert editor; the officers **list** surfaces each officer's SIA-expiry status inline.
- `src/app/api/cron/compliance-alerts/route.ts` — the weekly digest ([`13-crons.md`](./13-crons.md)).

## Business rules & invariants

- **Per-item status:** `missing` (nothing recorded — SIA/DBS only), `expired` (date passed), `expiring` (within the 30-day warning window), `valid` (in date, or a non-expiring RTW/cert). An officer's **worst** item drives their row.
- **Null means different things per item:** a null SIA expiry is a gap (`missing`); a null right-to-work expiry is indefinite (`valid`); a null cert expiry is non-expiring (`valid`); a null DBS date is `missing`.
- **Scope:** active `OFFICER` + `DISPATCHER` users only.
- **Admin-only** register and cert actions (`requireAdmin`).

## Entry points

- **Actions:** `addCertificationAction(officerId, {...})`, `deleteCertificationAction(id, officerId)`, and the vetting dates saved through the normal `createOfficer` / `updateOfficer` (`officers/_actions.ts`).
- **Cron:** `/api/cron/compliance-alerts` (`30 8 * * 1`) → `expiringComplianceItems(30)` → one digest email to `ADMIN_EMAIL`/`COMPANY.email`. No-op until email + a recipient are set.
- **Nav:** the `/compliance` link on the officers list header and the Operations hub (with a "needs attention" count).

## Extension points & gotchas

- **The 30-day warning window is a constant** (`warnDays` default in `compliance.ts`); per-contract windows would be a small extension.
- **DBS has no expiry model** — only a "last checked" date, shown as recorded/not. If you adopt a fixed DBS renewal policy, add an expiry the way SIA works.
- **No document storage** — this tracks dates/refs, not scans. Attaching the actual licence/DBS PDFs would build on the blob-upload plumbing in [`12-integrations-webhooks.md`](./12-integrations-webhooks.md).
- **Alerts reuse the finance email transport** (`src/lib/email.ts`, Resend) — the digest is a no-op until `RESEND_API_KEY` + a recipient exist, exactly like the invoice/contract reminders.
