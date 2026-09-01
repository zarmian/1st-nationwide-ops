# Deployment & Operations

> How the platform is built, deployed, configured, and kept running — plus the one-time setup that only a human with production access can do.

## Purpose & scope

Everything operational: the deploy pipeline, environment variables, database migrations, one-time bootstrap, and external-service setup. Companion to the setup checklists already in [`../prod-setup.md`](../prod-setup.md) and [`../whatsapp-setup.md`](../whatsapp-setup.md).

## Deploy pipeline

```
edit → commit + push → PR → merge to main → Vercel auto-deploys
```

- **Live URL**: `https://1st-nationwide-ops.vercel.app`
- **Build command**: `prisma generate && prisma migrate deploy && next build`
- Vercel auto-deploys on merge to `main`. `prisma migrate deploy` applies any new migrations to Supabase on every deploy — **code-only changes need no manual step**.

## Database & migrations

- **Postgres on Supabase** (EU-West / London). Prisma ORM.
- **Any change to `prisma/schema.prisma` MUST ship with a matching migration** in `prisma/migrations/<UTC-timestamp>_<name>/migration.sql`. Without it the deployed app crashes with `P2022` (column does not exist) / `P2010` (relation does not exist). Copy an existing migration dir as a template; name it with a UTC timestamp prefix so it sorts chronologically.
- The old `prisma db push --accept-data-loss` flow is **retired** — it can silently drop columns. Do not reintroduce it. Never add `--accept-data-loss` now there is real data.
- Generate a new migration locally with `prisma migrate dev --name <name>`; it is applied in production by `prisma migrate deploy` at build time.

## Environment variables (set in Vercel)

| Var | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** (port 6543). Append `?connection_limit=5&pool_timeout=20`. | Yes |
| `DIRECT_URL` | Supabase **Session pooler** (port 5432) — **not** "Direct connection" (IPv6-only; fails from Vercel). Used for migrations. | Yes |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | Auth. `NEXTAUTH_URL` = the live origin. | Yes |
| `INIT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | One-time admin bootstrap via `/api/admin/init`. | Bootstrap |
| `CRON_SECRET` | Authorises cron routes (see `src/lib/cronAuth.ts`). | Yes (prod) |
| `ENCRYPTION_KEY` | AES key for alarm/padlock access codes (`src/lib/crypto.ts`). | If codes stored |
| `ANTHROPIC_API_KEY` | Telegram bot intent routing (`src/lib/anthropic.ts`). | Bot |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` | Telegram bot. | Bot |
| `WHATSAPP_PHONE_ID` / `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API. Notifications queue but stay `SKIPPED` until set. | WhatsApp |
| `SMS_WORKS_JWT` | SMS Works API (SMS channel). | SMS |
| `RESEND_API_KEY` / `EMAIL_FROM` | Resend (emailing invoices + payslips via `src/lib/email.ts`). Buttons report "not set up yet" until set; `EMAIL_FROM` must be a Resend-verified sender. | Email |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (photo/signature uploads). | Uploads |
| `BONLINE_WEBHOOK_SECRET` | Validates inbound bOnline call webhooks. | Calls |
| Sentry (`SENTRY_*`) | Error reporting. Without it, prod errors are silent. | Recommended |
| Upstash/Vercel KV (`KV_*` / `UPSTASH_*`) | Rate limiting. No-op if unset. | Recommended |

`SKIP_ENV_VALIDATION=1` bypasses env validation for local builds/CI.

## One-time bootstrap

1. Set `INIT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` in Vercel.
2. Call `POST /api/admin/init` with the secret → creates the first `ADMIN` user. See [`02-access-auth-roles.md`](./02-access-auth-roles.md).
3. Log in at `/login`.

## Company / invoice details

Customer invoices render from constants in **`src/lib/company.ts`** (name, registered address, **VAT number**, company number, bank details, payment terms, default VAT rate). Fill these in before issuing a real invoice — the VAT number and address are legally required, and the invoice PDF flags their absence until set. It's a code file (not env), so changing it is a commit + deploy.

## Seeding

- `npm run db:seed` (`prisma/seed.ts`) — imports sites/regions/keys from `import_out/*.csv` and seeds baseline rows (the `shift-hourly-check` blueprint, the global `SHIFT_CHECK` form template, partners). Runs with `tsx`.
- `npm run db:seed:demo` — demo data. `npm run db:import:nexus` — Nexus site import. `npm run db:encrypt-codes` — encrypts any plaintext access codes.
- Seeding needs Node + a `DATABASE_URL` pointing at the target DB.

## Crons

11 scheduled routes registered in `vercel.json`, all gated by `CRON_SECRET` (`src/lib/cronAuth.ts`). They materialise patrol visits & lock/unlock jobs, sweep visit/shift statuses, drain the WhatsApp and SMS queues, send the morning Telegram brief and reminders, run payroll summaries, and clean up blobs. Full table in [`13-crons.md`](./13-crons.md).

## External-service setup (human-only)

- **WhatsApp** — Meta Business Manager + 6 approved message templates. Multi-hour admin task; see [`../whatsapp-setup.md`](../whatsapp-setup.md). Until done, WhatsApp notifications sit `SKIPPED` (Telegram broadcast still works).
- **Telegram** — create a bot with @BotFather, set env vars, register the webhook (the `/telegram` admin page + `WebhookSetup` component do this), then each staff member links their chat via a one-time code.
- **bOnline** — point the phone system's webhook at `/api/webhooks/bonline/[secret]`.
- **Sentry / KV** — recommended before sharing the URL widely.

## Runbook essentials

- **Rollback**: revert the merge commit; Vercel redeploys. If a migration is involved, write a corrective forward migration (don't hand-edit history).
- **Smoke test after each release**: the checklist in [`../prod-setup.md`](../prod-setup.md) (§"Smoke tests") walks the critical paths in ~5 minutes.
- **"No data / counts all zero"** on `/admin` usually means a connection-pool issue — check `DATABASE_URL`'s `connection_limit`.
- **Notifications not arriving**: check `/admin/notifications` — rows in `SKIPPED` mean the channel isn't configured; `FAILED` means the provider rejected them (error stored on the row).
