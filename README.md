# 1st Nationwide Ops

Internal operations platform for **1st Nationwide Security Services Ltd**.

Replaces the Nexus Google Sheet with a single source of truth for sites, keys, patrols, alarm responses, lock/unlocks, VPI, officer reports, and the daily client report email flow.

---

## What it is

- **Sites & customers** — every site we cover, its services, region, and keys held.
- **Jobs** — a universal record for every callout, patrol, lock/unlock, VPI, etc., across:
  - direct customers (Shurgard, Aegis, Orbis, …)
  - partners we serve as a customer (Nexus Security in London, Keyholding Co)
  - partners we sub work out to (Nexus Security outside London)
- **`/submit` form** — one permanent URL. An officer picks the site, the type of job, and fills the form. Replaces FastField.
- **Review queue** — admin reviews submissions in the morning and sends the customer report (PDF email).
- **Officer mobile view** — `/m/today` shows today's jobs.
- **Dispatch** — live view of all in-flight jobs.

---

## Stack

- Next.js 14 (App Router) + TypeScript
- Postgres on Supabase (EU-West, London)
- Prisma ORM
- NextAuth (email + password)
- Tailwind CSS
- Vercel for hosting

---

## Local development

You don't normally need to run this locally — the workflow is push → Vercel preview deploy. But if you want to:

```bash
npm install
cp .env.example .env.local           # fill in DATABASE_URL etc.
npx prisma generate
npx prisma migrate dev                # creates the schema
npm run db:seed                       # imports the CSVs from ../import_out
npm run dev
```

Then open <http://localhost:3000>.

---

## Deployment workflow

```
git push → Vercel preview URL on the PR → merge → main = production
```

### One-time setup

1. **Supabase** — create an EU-West project. Copy the pooled (`6543`) URL into `DATABASE_URL`, the direct (`5432`) URL into `DIRECT_URL`. Enable the `pgcrypto` and `citext` extensions.
2. **Vercel** — import this repo. Add env vars: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `APP_URL`.
3. **First migration** — Vercel runs `prisma generate` automatically on build. To apply migrations, run `npx prisma migrate deploy` in a one-off Vercel CLI session, or trigger it from a deploy hook.
4. **Seed** — locally or via Vercel CLI: `npm run db:seed` once, with the `import_out/` CSVs reachable.

### Admin login

The seed script creates an initial admin user. Default:

```
email:    admin@1stnationwidesecurity.co.uk
password: Change-me-now-1
```

**Change this immediately** after first login. To set custom values at seed time, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in env.

---

## Folder layout

```
app/
├── prisma/
│   ├── schema.prisma       # the data model
│   └── seed.ts             # imports CSVs from ../import_out
├── src/
│   ├── app/                # Next.js App Router routes
│   │   ├── (app)/          # authenticated pages (TopNav layout)
│   │   │   ├── sites/      # site list + detail
│   │   │   ├── m/today/    # officer mobile view
│   │   │   ├── dispatch/   # live job board
│   │   │   └── admin/reports/  # review queue
│   │   ├── api/            # route handlers
│   │   ├── login/          # sign-in page
│   │   └── submit/         # PUBLIC officer report form
│   ├── components/         # shared React components
│   ├── lib/                # auth, prisma client
│   └── types/              # type augmentations
├── middleware.ts           # protects (app)/* routes
└── tailwind.config.ts      # brand tokens (mint #2FCB80, navy #0F1929)
```

---

## Brand

- Mint green: `#2FCB80`
- Navy: `#0F1929`

Tailwind tokens: `bg-brand-mint`, `text-brand-navy`, `bg-brand-mint-light`.
