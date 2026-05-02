# Chat Summary — "Fix Missing Apps in Git Installations"

**Session:** `session_01Nx9iW1FKpsyPA6qPvuzNbW`
**Project:** 1st Nationwide Ops (Next.js + Prisma + Supabase, Vercel-hosted)
**Outcome:** Branch merged to `main`, Vercel deployed cleanly.

## Opening issue

User reported that only Vercel was showing under the GitHub repo's *Apps in Git Installations* — other expected apps (Claude GitHub App, Supabase) were missing. Clarified this is a GitHub settings concern, not a codebase issue, and pointed to `github.com/settings/installations` to reinstall any missing apps.

## Database seeding task

User asked Claude to read `CLAUDE.md`, run `npm install`, and seed the DB with 485 sites from `..\..\Claude\Projects\1st Nationwide\import_out\`. Initial attempts failed because the working branch hadn't been pulled — `.env` wasn't being picked up. Walked the user through GitHub Desktop steps to switch to `claude/fix-git-installations-apps-dk9Od`, pull, and re-run the seed.

## Site management UI build

Multiple commits across:

- **Sites list page** — live search (200ms debounce), instant filters (Region/Service/Type with mint-outline active state), bulk edit (per-row checkbox + sticky bar with Customer/Region dropdowns using `updateMany`).
- **Site create/edit forms** — code, name, address, postcode, city, type, region, customer/partner, services (multi-select), risk level, active toggle, notes. Server-side validation + postcode normalisation.
- **Site detail page** — header + breadcrumb, service chips (auto-computed), tabs (Overview / Schedule / Keys / Activity / Documents / Settings), activity timeline. Known limitations flagged: Customer contact only shows one contact (schema), Documents tab is a stub, "Log activity" pre-fills the submit form.

## Sandbox/Vercel connectivity blocker

Claude Code sandbox has a strict outbound hostname allowlist that blocks `*.vercel.app`, `*.supabase.com`, and most of the internet. Could not run `npm run dev` or test in a browser. All testing has to happen locally after merging. Claude apologised for an earlier Vercel-toggle errand that couldn't have helped.

## Onboarding & patrol module

Designed and implemented the patrol/visit lifecycle:

- **States:** `PENDING → IN_PROGRESS → COMPLETED`, with auto-escalation to `LATE` (+1h) and `MISSED` (+24h) via cron.
- **Officer flow:** `/m/today` → tap "I'm on site" (GPS captured) → fill patrol form → submit → admin review queue.
- **Per-site/customer form templates** — architectural shift. Schema covers field types: `alpha_*`, `multiline_*`, `tri_*`, `datepicker_*`, `signature_*`, `multiphoto_picker_*`.
- **Deferred:** photos (needs Vercel Blob), GPS distance validation, dispatcher notifications for LATE/MISSED.

## Onboarding page (`/onboarding`)

Replaced "coming soon" stub with working page: active pipelines grouped by stage (Proposed / Site survey / Key collection / Live). Two Prisma migrations for new enum values (`SURVEY`, `ONBOARDING`). Commit `0effb1a`.

## Deployment & resolution

After merge to `main`, Vercel picked up the fresh build and applied migrations cleanly (`migrate deploy` was a no-op since prod DB already had the data). User confirmed "it is now showing all the changes", likely after Vercel retried the earlier failed deploy on the new build.

## Remaining work (queued at end of session)

- Photos on form templates — needs Vercel Blob storage (~1 hour to wire up)
- Daily Shurgard report email — needs an email provider (Resend recommended)
- Email ingest from partners — parsing Nexus/Keyholding alarm emails
- Officer pay tracking — Stage 3, finance fields
- Form-builder polish — flagged for later

## Errors at end of session

Several API `400` errors (`messages: text content blocks must be non-empty`) appeared near the end. Caused by empty/near-empty user messages — not a code problem.
