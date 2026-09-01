# System Overview

> 1st Nationwide Ops is an internal operations platform for a UK manned-security firm — a single source of truth for sites, keys, patrols, alarm responses, lock/unlocks, officer reports, jobs, finance, and the client-report flow. It replaces a sprawling "Nexus" Google Sheet.

This folder (`docs/system/`) is a **module-by-module reference** written so the platform can be understood, extended, or **rebuilt better**. Each module doc follows the same shape: purpose → data model → key files → core flows → business rules & invariants → entry points → extension points & gotchas.

---

## 1. What the system does

| Area | In one line |
|---|---|
| **Sites & customers** | Every site we cover — services, region, keys, access notes, rates. |
| **Keys** | Every key / fob / padlock / code, which set it belongs to, and who holds it. |
| **Scheduling** | Recurring patrol visits and lock/unlock schedules; static-guarding & dog shifts; a weekly rota. |
| **Dispatch / Jobs** | One universal `Job` record for every callout, patrol, lock/unlock, VPI, alarm response. Live board + history. |
| **Officer reports** | One permanent public URL (`/submit`); officer picks a site + job type and fills a dynamic form. |
| **Review & client reports** | Admin reviews submissions and issues the customer report (PDF/email). |
| **Finance** | Customer billing + officer pay, snapshotted per activity; P&L, payroll, **invoicing (VAT), partner statements, recurring billing** and a billing-exceptions report. |
| **Partners** | Three simultaneous relationship modes (see §3). |
| **Notifications** | Unified queue → WhatsApp, SMS, and Telegram broadcast to dispatch. |
| **Telegram bot** | Conversational dispatch assistant with an AI intent router. |
| **Integrations** | bOnline phone-call webhook, geocoding, blob uploads, live map. |

The full module map is in [`README.md`](./README.md).

---

## 2. Tech stack & architecture

- **Next.js 14 (App Router) + TypeScript** — server components by default; `"use client"` only where interaction demands it; **server actions** (`_actions.ts`) for mutations.
- **Prisma ORM** over **Postgres on Supabase** (EU-West / London). 40 models — see [`01-data-model.md`](./01-data-model.md).
- **NextAuth v4** — email + password (bcrypt). Session augmented with `role` + `partnerId`. See [`02-access-auth-roles.md`](./02-access-auth-roles.md).
- **Tailwind CSS** with brand tokens (`brand-blue` `#3B82F6`, `brand-navy` `#0F1929`) and a small primitive layer (`.btn`, `.input`, `.card`, `.table-default`…) in `src/app/globals.css`. See [`14-conventions-and-ui.md`](./14-conventions-and-ui.md).
- **Vercel** hosting; auto-deploy from `main`. Build runs `prisma generate && prisma migrate deploy && next build`, so **every schema change needs a matching migration**. See [`15-deployment-and-ops.md`](./15-deployment-and-ops.md).
- **Vercel Cron** drives 11 scheduled routes (materialise schedules, drain notification queues, status sweeps). See [`13-crons.md`](./13-crons.md).
- **External services**: Anthropic Messages API (Telegram bot intent routing), Meta WhatsApp Cloud API, SMS Works (SMS), Vercel Blob (photos/signatures), bOnline (inbound calls), Leaflet/OSM (map), Sentry (errors), Upstash/Vercel KV (rate limiting).

### Request lifecycle (typical)

```
Browser ──▶ middleware.ts (role gate) ──▶ (app|partner) layout (re-checks session+role)
        ──▶ Server Component (reads via Prisma) ──▶ HTML
Mutations ──▶ Server Action (_actions.ts) or Route Handler (api/**) ──▶ Prisma ──▶ revalidate/redirect
Side effects (notifications, PDFs) are fire-and-forget or queued, never block the response.
```

### Folder layout

```
prisma/
├── schema.prisma            # the data model (40 models, 37 enums)
├── migrations/              # applied in order by `prisma migrate deploy`
└── seed.ts                  # CSV import + baseline seed
src/
├── app/
│   ├── (app)/               # authenticated staff UI (TopNav shell)
│   ├── partner/             # partner + partner-officer portal (separate shell)
│   ├── submit/              # PUBLIC officer report form
│   ├── duty/[token]/        # PUBLIC shift duty runner (tokenised)
│   ├── jobs/                # PUBLIC open-jobs claim board
│   ├── login/               # auth
│   └── api/                 # route handlers: auth, submissions, crons, webhooks, exports
├── components/              # shared UI primitives (TopNav, DataTable, Confirm, Toast, …)
├── lib/                     # business logic (billing, notifications, telegram, dates, …)
├── types/                   # next-auth session augmentation
└── middleware.ts            # route protection (public paths whitelisted)
docs/system/                 # ← you are here
```

Business logic lives in **`src/lib/`** (pure-ish, unit-tested with vitest) and is called from server components, server actions, API routes, and crons. When rebuilding, `src/lib/` is the part worth preserving conceptually — the UI is replaceable, the rules are not.

---

## 3. The operating model (read this before anything else)

1NW operates in **three relationship modes at once**. The schema and every report must handle all three. This is the single most important business concept and the easiest to get wrong.

1. **Direct customer** (Shurgard, Aegis, Orbis). We get the alarm/job → **our** officer attends → our admin reviews the report → we send the client a daily email/PDF. Produces a `ClientReport`.
2. **Partner-as-customer** — a partner uses **us** as their subcontractor (e.g. Nexus for their London alarm activations; Keyholding Company on-demand). **Our officer fills in the _partner's_ app, not ours.** We keep an internal stub `Job` for pay tracking. `Job.reportedViaPartnerApp = true` → **no `/submit` flow, no `ClientReport`**. Tagged via `Site.partnerId`.
3. **Partner-as-subcontractor** — we sub work out to a partner (e.g. Shurgard sites outside London → Nexus). **Their** officer attends and fills in **their** app; they email the report back. Tracked via `Job.handledByPartnerId` + `Job.partnerReportRef`; a 15-minute Telegram reminder chases dispatch for the update until the job is closed.

Consequences a rebuild must preserve:
- **A `Job` may have a `Customer`, or a `Partner`, or neither** — never assume a customer.
- **Not every `Job` produces a `ClientReport`** — partner-app jobs don't.
- **Two distinct partner links exist**: `Site.partnerId` / `Job.partnerId` (partner-as-customer) vs `Job.handledByPartnerId` (partner-as-subcontractor). They mean opposite things.
- Officer pay tracking uses a `FormSubmission` **or** the `Job` stub when `reportedViaPartnerApp = true`.

Full detail in [`08-partners.md`](./08-partners.md).

---

## 4. Roles & surfaces

| Role | Sees | Entry |
|---|---|---|
| `ADMIN` | Everything: dispatch, sites, finance, admin, review queue. | `/dispatch` |
| `DISPATCHER` | Dispatch, sites, review queue — **not** finance/admin (except `/admin/reports`). | `/dispatch` |
| `OFFICER` | Mobile only: `/m/*`, `/submit`. | `/m/today` |
| `PARTNER` | Partner portal admin: activities, officers, rates, finance. | `/partner` |
| `PARTNER_OFFICER` | Partner mobile: today's assigned work. | `/partner/m/today` |

Route gating is defence-in-depth: `middleware.ts` is primary; the `(app)` and `partner` layouts re-check server-side. See [`02-access-auth-roles.md`](./02-access-auth-roles.md).

Public (unauthenticated) surfaces: `/login`, `/submit`, `/duty/[token]`, `/jobs`, `/offline`, and the webhook/cron API routes (secret-gated).

---

## 5. Cross-cutting conventions (the short version)

- **Dates/times** always go through `src/lib/dates.ts` (en-GB, Europe/London). Never hand-roll `toLocaleString`; never trust server-local time (Vercel runs UTC). Money/numbers through `src/lib/numbers.ts` (`Intl`).
- **Activity attribution is by _scheduled_ date, never `createdAt`** — a job for the 2nd added on the 4th belongs to the 2nd everywhere. Enforced by `src/lib/activityWhen.ts`.
- **Mutations are server actions** returning a small result object; UI shows a `Toast`; destructive actions go through the `Confirm` modal.
- **Notifications never block** — domain events funnel through `queueAll` (queues WhatsApp rows + broadcasts to Telegram); crons drain the queues.
- **Migrations are mandatory** for any `schema.prisma` change (the build applies them).

See [`14-conventions-and-ui.md`](./14-conventions-and-ui.md) for the full list.

---

## 6. Where to start if you're rebuilding

1. Read this file, then [`01-data-model.md`](./01-data-model.md) and [`08-partners.md`](./08-partners.md) — the model and the three-mode operating logic are the load-bearing walls.
2. Then the domain you care about (dispatch, scheduling, finance…).
3. `src/lib/` + its `*.test.ts` files are the executable spec of the business rules — keep them in view.
