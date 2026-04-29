# 1st Nationwide Ops — context for Claude

## What this project is

Internal operations platform for **1st Nationwide Security Services Ltd** (UK). Replaces the "Nexus" Google Sheet with a single source of truth for sites, keys, patrols, alarm responses, lock/unlocks, VPI, officer reports, and the daily client report email flow.

The user (Zaryab Rashid, `zarmian@gmail.com`) is **non-technical** — running the business, not the codebase. Drive every change end-to-end. Don't ask the user to run commands unless absolutely needed; do it yourself, then have them review the result.

## Operating model — important

1NW operates in three relationship modes simultaneously. The schema and reports must handle all three:

1. **Direct customer** — Shurgard, Aegis, Orbis. We get the alarm/job, our officer attends, our admin reviews the report, we send a daily email/PDF.
2. **Partner-as-customer (we're their subcontractor)** — Nexus Security uses us for their London alarm activations. Keyholding Company also sends us on-demand jobs. **Our officer fills in the partner's app, not ours.** We keep an internal stub record (site, time, who attended, outcome) for officer pay tracking. No `ClientReport` is generated.
3. **Partner-as-subcontractor (we sub work to them)** — Shurgard sites outside London get subcontracted to Nexus. Their officer fills in their own app. They email the report back to us. We then ingest that into our daily Shurgard email.

Schema reflects this:
- `Partner` model with `PartnerRole` (CUSTOMER / SUBCONTRACTOR / BOTH). Nexus and Keyholding Co are BOTH.
- `Site.partnerId` — partner-customer sites (Nexus's London sites) tagged via this.
- `Job.reportedViaPartnerApp: Boolean` — when true, no `/submit` flow, no `ClientReport`.
- `Job.partnerReportRef: String?` — for pasting the partner's PDF reference when they send their report back.

**Don't assume a Job has a Customer — it may have only a Partner. Don't assume every Job produces a ClientReport — partner-app jobs don't. Officer pay tracking uses FormSubmission OR the Job stub (when reportedViaPartnerApp=true).**

## Tech stack

- Next.js 14 (App Router) + TypeScript
- Prisma ORM
- Postgres on Supabase EU-West (London region)
- NextAuth v4 (email + password, bcrypt)
- Tailwind CSS — brand tokens: mint `#2FCB80`, navy `#0F1929`
- Vercel deployment, auto-deploy from `main`

## Deployment workflow

```
edit files → commit + push (GitHub Desktop) → Vercel auto-deploys
```

**Live URL:** https://1st-nationwide-ops.vercel.app
**Repo:** https://github.com/zarmian/1st-nationwide-ops

### Env vars (set in Vercel)
- `DATABASE_URL` — Supabase Transaction pooler (port 6543)
- `DIRECT_URL` — Supabase **Session pooler** (port 5432) **NOT** "Direct connection" (IPv6-only, won't work from Vercel)
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` — `https://1st-nationwide-ops.vercel.app`
- `INIT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` — used by `/api/admin/init` (one-time bootstrap)

### Build command
```
prisma generate && prisma db push --skip-generate --accept-data-loss && next build
```

`prisma db push` on each build syncs schema changes automatically. **Eventually replace this with proper `prisma migrate dev` / `prisma migrate deploy`** once we want migration history. The `--accept-data-loss` is risky — be careful with destructive schema changes.

## Folder layout

```
prisma/
├── schema.prisma          # the data model (19 models)
└── seed.ts                # imports CSVs from ../import_out (NOT YET RUN)
src/
├── app/
│   ├── (app)/             # authenticated pages (TopNav layout)
│   │   ├── sites/         # list + detail
│   │   ├── m/today/       # officer mobile
│   │   ├── dispatch/      # live job board
│   │   └── admin/reports/ # review queue
│   ├── api/
│   │   ├── auth/[...nextauth]/  # NextAuth endpoints
│   │   ├── admin/init/          # one-time admin bootstrap
│   │   └── submissions/         # /submit form POST handler
│   ├── login/             # login + LoginForm (Suspense-wrapped)
│   └── submit/            # PUBLIC officer report form
├── components/            # BrandLogo, TopNav, Providers
├── lib/                   # auth.ts, db.ts (Prisma singleton)
└── types/                 # next-auth.d.ts (session augmentation)
middleware.ts              # protects (app)/* — /submit is intentionally public
tailwind.config.ts         # brand tokens
```

## Current state — what works

- Login at `/login` with the admin user created via `/api/admin/init`
- Database schema applied (19 tables in Supabase)
- Empty Sites page renders at `/sites`
- Empty Dispatch board renders at `/dispatch`
- Empty admin review queue renders at `/admin/reports`
- `/submit` form renders publicly (officer can pick a site, but list is empty)

## What's NOT done yet

- **Real seed data not loaded**. The 485 sites, regions, keys, schedules from the importer's `import_out/*.csv` are still in the user's project folder at `Documents\Claude\Projects\1st Nationwide\import_out\` but haven't been imported. `prisma/seed.ts` reads them but has never run because the user doesn't have Node.js installed.
- **No partners seeded** (Nexus, Keyholding Co, Aegis, Orbis, Shurgard) — these need creating before partner-customer sites can be tagged.
- **Daily Shurgard report email** — placeholder only. `ClientReport` rows can be created but nothing sends them. Format TBC with Shurgard.
- **/submit form** — works end-to-end functionally but missing photo uploads, GPS, more form fields per job type.
- **Admin review/edit UI** — list page exists, but no detail/edit/approve action yet.
- **Site editing UI** — `/sites/new` and `/sites/[id]/edit` linked but not built.
- **Email ingest from partners (Nexus, Keyholding Co)** — alarm activation emails arrive at our inbox. No automation yet to parse them into `AlarmEvent` rows.
- **Officer pay tracking** — finance fields placeholder on `Job` (Stage 3).
- **Tech spec doc refresh** — at `Documents\Claude\Projects\1st Nationwide\1st_Nationwide_Ops_Technical_Spec.docx`, predates the operating-model changes. Should be rewritten before sharing externally.

## Immediate next steps (suggested order)

1. **Run the seed locally** to load the 485 sites — needs `npm install` + `npm run db:seed` from this folder. The CSVs are at `../../../Claude/Projects/1st Nationwide/import_out/` from the repo root.
2. **Create migration history** — replace `prisma db push` in build with `prisma migrate deploy`, generate the initial migration with `prisma migrate dev --name init`.
3. **Seed partners** — Nexus Security (BOTH), Keyholding Co (BOTH), Aegis (CUSTOMER), Orbis (CUSTOMER), Shurgard (CUSTOMER). Probably a small script in `prisma/seed.ts`.
4. **Build /sites/new + /sites/[id]/edit** so the admin can manage the list manually.
5. **Build the admin review detail page** at `/admin/reports/[id]` — show the submission, allow edits, approve → trigger ClientReport row.

## House rules

- Don't push without local typecheck passing (`npx tsc --noEmit`).
- Don't add `--accept-data-loss` to migrations once we have real data.
- Brand voice for any user-facing copy: clear, no jargon, no security industry clichés.
- The user is non-technical. When asking the user a question, give 2–4 concrete options rather than open-ended.
