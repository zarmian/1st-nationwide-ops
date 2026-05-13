# Production setup checklist

Living checklist of things only the admin (Zaryab) can do on the live
deployment. Tick items off as you go. Anything marked **optional** is fine to
skip until/unless the underlying feature is being used.

## After every merge to `main`

Vercel auto-deploys. The build runs `prisma migrate deploy`. You don't need
to do anything for code-only changes.

## After the auto-billing / officer-rates / shifts merge

1. **Pull locally + run seed**, with prod `DATABASE_URL` in `.env`
   temporarily (swap back after).
   ```
   git pull
   npm install
   npm run db:seed
   ```
   Seeds the `shift-hourly-check` blueprint and the global `SHIFT_CHECK`
   form template.

2. **Set officer pay rates** — visit `/admin/officer-rates` and add:
   - A **Company default** row per service: Alarm response, Patrol, Lock-up,
     Unlock, VPI, Ad-hoc — unit *per visit*.
   - Static guarding / Dog handler — unit *per hour*.
   - **Monthly retainer** rows per officer who gets one — unit *per month*.
   - Per-officer overrides where applicable.
   - Excess fields are optional.

3. **Click "Bill missing"** on `/finance` — backfills billed + pay for every
   completed visit/job. Idempotent; safe to re-run any time.

## Outstanding environment setup (still queued from earlier rounds)

| Item | Where | Why |
|---|---|---|
| **`ENCRYPTION_KEY`** | Vercel env vars | Encrypts alarm/padlock codes. Already set per earlier checklist. |
| **`DATABASE_URL` connection_limit** | Vercel env vars | Append `?connection_limit=5&pool_timeout=20`. Already done per earlier checklist. |
| **Sentry (5 env vars)** | Vercel env vars + sentry.io free tier | Without it, prod errors are silent. **Recommended this week.** |
| **Vercel KV** | Vercel → Storage → Create | Without it, rate limiting is a no-op. **Recommended before sharing the URL widely.** |
| **`npm run db:encrypt-codes`** | Local terminal with prod DATABASE_URL | Only needed if you've entered alarm/padlock codes on any site. Skip if you haven't. |
| **WhatsApp setup** | Meta Business Manager + 6 templates | Follow `docs/whatsapp-setup.md`. Several hours of admin work. Notifications queue but stay `SKIPPED` until done. |

## Smoke tests after each major release

A 5-minute walk-through to catch deployment regressions:

- [ ] `/admin` — all tile counts load (catches the connection-pool bug class).
- [ ] `/sites` — list paginates; click into one, all tabs (Overview /
      Schedule / Keys / Finance / Activity / Documents / Settings) render.
- [ ] `/dispatch/new` — pick a site, create an ad-hoc test job → redirected
      to `/dispatch` with the job listed and a billed chip.
- [ ] `/finance` — "Earned today" shows non-zero after the test job; per-
      account P&L lists the customer/partner.
- [ ] `/admin/officer-rates` — defaults + per-officer lists render.
- [ ] `/admin/imports/nexus` — page loads (don't run reset unless intended).
- [ ] `/m/today` — log in as an officer, tap **Start shift** → location
      banner shows "Location shared Xs ago"; **End shift** flips back.
- [ ] `/shifts/new` — create a test shift, then complete the cycle on
      `/m/today` (Start → Submit hourly check → End).
- [ ] `/admin/notifications` — queue page loads, banner appears if WhatsApp
      env isn't set.

## Backlog (build on demand)

Items the user has requested but aren't built yet. Pick one and message
Claude to start.

- Monthly payroll CSV export.
- Date-range scope on `/finance`.
- Daily Shurgard report email (needs Resend / email provider).
- Email ingest from partners (Nexus, Keyholding Co) → AlarmEvent rows.
- WhatsApp groups OR a Telegram channel as an alternative.
- Capacitor native app for real background GPS.
