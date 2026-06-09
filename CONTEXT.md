# Handoff context — 1NW Ops platform

A snapshot of where the project is, what's been shipped, the conventions to
follow, and the open threads. Read alongside `CLAUDE.md` (which has the
business-model context — three operating modes, partners-as-customers, etc.)
and the recent git log.

---

## TL;DR

- **Stack:** Next.js 14 (App Router) + Prisma + Supabase Postgres + Tailwind +
  NextAuth (email/password) + Vercel.
- **Brand:** `brand-blue` (#3B82F6) primary, `brand-navy` (#0F1929) dark — was
  mint, swapped in PR #23.
- **Operator:** Zaryab — non-technical; never ask them to run commands, ship
  end-to-end yourself.
- **Branch you should be on:** `claude/review-chat-api-error-oVuda`. PRs merge
  to `main`; Vercel auto-deploys on merge, applying migrations via
  `prisma migrate deploy` in the build step.

---

## Quick orientation

### Where things live
```
prisma/
├── schema.prisma          # 19+ models
├── migrations/            # 25+ migrations, applied in order
└── seed.ts                # CSV importer (CSVs at ../../../Claude/Projects/...)
src/
├── app/
│   ├── (app)/             # authenticated pages, wrapped by AppShell layout
│   │   ├── activities/    # unified ops activity log (Job + Visit + Shift + orphan FormSubmission)
│   │   ├── dispatch/      # live job board + job detail at /dispatch/[id]
│   │   ├── finance/       # admin-only dashboard
│   │   │   ├── activities/         # admin-only mirror of /activities with money cols
│   │   │   ├── officers/[id]/      # per-officer P&L
│   │   │   ├── partners/[id]/      # partner two-sided view
│   │   │   ├── payroll/            # monthly payroll
│   │   │   └── _actions.ts         # recalculateBilling
│   │   ├── keys/                   # keys list + /keys/[id] detail + /keys/[id]/edit
│   │   ├── key-sets/[id]/          # set detail with photo upload + bulk handover
│   │   ├── m/today/                # officer mobile home
│   │   ├── patrols/                # schedule list + /patrols/visits/[id]
│   │   ├── sites/                  # list + /sites/[id] detail with tabs
│   │   ├── shifts/                 # static-guarding shifts
│   │   ├── admin/                  # admin hub + reports queue + customers/partners
│   │   ├── operations/             # ops hub (cards linking to schedules/shifts/keys/...)
│   │   └── layout.tsx              # AppShell — auth + role gate (reads x-pathname)
│   ├── api/
│   │   ├── submissions/route.ts    # the /submit handler
│   │   ├── blob/upload-token/      # Vercel Blob signed upload
│   │   └── activities/export/      # CSV export — admin only
│   ├── submit/                     # PUBLIC officer report form
│   └── layout.tsx                  # root — next/font Inter via --font-sans
├── components/
│   ├── PageHeader.tsx              # back link + h1 + subtitle + actions
│   ├── EmptyState.tsx              # dashed-border empty pattern
│   ├── StatusDot.tsx               # coloured dot, optional pulse
│   ├── ActivityStatus.tsx          # maps Job/Visit status → StatusDot
│   ├── CountUp.tsx                 # animated number tween (KPIs)
│   ├── FilterPills.tsx             # client pill toggle, writes URL params
│   ├── Skeleton.tsx                # shimmering placeholder
│   ├── Confirm.tsx                 # Promise-based modal confirm
│   ├── Toast.tsx                   # in-house toast queue
│   ├── BrandLogo.tsx               # inline SVG, colour from tokens
│   └── TopNav.tsx                  # icons + avatar + nav indicator
├── lib/
│   ├── authz.ts                    # requireUser / requireStaff / requireAdmin
│   ├── dates.ts                    # ukWallClockToUtc, parseUkDateTimeLocal, ukDayString
│   ├── patrolDates.ts              # shouldCreateVisitOn / evaluateSchedule
│   ├── scheduleSync.ts             # cron materialise visits + lock/unlock jobs
│   └── billing.ts                  # billForSite / payForOfficer
middleware.ts                       # role gate + sets x-pathname for layout backstop
tailwind.config.ts                  # brand + scales + gradients + shadows
```

### Local commands that work
```bash
npx tsc --noEmit                   # typecheck
npm test                           # 133 vitest tests pass
npx next build                     # production build (needed for migration sanity)
npx next dev -p 3001               # dev server (port 3000 sometimes in use)
npx prisma generate                # after editing schema
```

Never commit with `--no-verify`. Never run `prisma db push --accept-data-loss`
— that flow was retired (data loss risk); migrations only.

### Deploy workflow
1. Edit on `claude/review-chat-api-error-oVuda`
2. `git push origin claude/review-chat-api-error-oVuda`
3. Open PR via `mcp__github__create_pull_request`, merge with
   `mcp__github__merge_pull_request`
4. Vercel auto-deploys from `main` (~2 min, includes migrations)

---

## What's been built — PR-by-PR (recent first, condensed)

Numbering follows the in-repo PR sequence. Each line: PR # — title — one-line
purpose.

### Session 2: ops correctness + data fidelity

- **#39** map `arrivedAt → Job.startedAt` on submission + backfill from
  `FormSubmission.arrivedAt`. Operator: "activity details page does not show
  start time."
- **#38** sweep every activity list to schedule-first ordering — finance
  officer / partner detail pages + dispatch completed+cancelled buckets.
- **#37** activities log + finance/activities + site activity feed: sort by
  `scheduledAt` / `scheduledFor` / `scheduledStartsAt`, not `completedAt`.
- **#36** orphan FormSubmissions surface in `/activities` (jobId IS NULL AND
  patrolVisitId IS NULL) + customer fallback on review-queue detail.
- **#35** auto-approve path now sets `Job.completedAt` (was leaving NULL,
  hiding from `/finance/activities`). Backfill migration uses `updatedAt`.
- **#34** (skipped, accidentally skipped over)
- **#33** `/dispatch/[id]` Customer/Partner card falls back to
  `job.site.customer ?? site.partner`.
- **#32** shift KPI cards: `hour12: false` + `timeZoneName: "short"` → shows
  "BST" / "GMT" suffix so the time is unambiguous.
- **#31** shifts in `/activities` + `/admin/reports` mobile (card list under
  md) + Europe/London timestamps on review queue.
- **#30** revert CountUp adoption on `/finance` — diagnostic for 500.
- **#29** fix CountUp closure-staleness — KPIs were sticking at 0.

### Session 1: UI/UX system + design tokens

- **#28** `m/today` shift indicator uses shared StatusDot + 4 native dialogs
  swept to brand modal (ShiftCard end, DeleteShift, DeleteRate,
  RecalcButton).
- **#27** Filter pills (FilterPills) adopted on activities/finance-activities
  Status + Group by; ActivityStatus mapper; CountUp adopted on finance KPIs;
  favicons swapped from logo.jpg to icon.svg.
- **#26** all 9 remaining tables converted to `.table-default` (sticky thead,
  blue hover, `.col-num` shorthand).
- **#25** finance per-account P&L table → `.table-default`; StatusDot on
  dispatch board.
- **#24** lucide-react icons in TopNav + finance KPIs; Confirm + Toast
  primitives wired into Cancel/Restore job; Avatar with initials, role
  tinted; StatusDot + Skeleton + ActivityStatus components.
- **#23** **mint → blue brand swap**. 198 references updated, hex literals
  replaced (#2FCB80 → #3B82F6), SVG icons + ambient backdrop + button
  gradients all flipped to blue. BrandLogo is now inline SVG rendered from
  tokens, no longer reads /logo.jpg.
- **#22** brand-grounded visual refresh: button gradient + lift, card-accent
  with blue stripe, ambient backdrop, full mint scale (later renamed),
  shadow-lift, animate-pop-in.
- **#21** site detail header de-cluttered (removed "+ New job", "+ Record
  callout", "Log activity"). Key set summary rows clickable to
  /key-sets/[id]. Finance Top Sites tables (by revenue + by activity).
- **#20** unified design system: foundation tokens, semantic colors,
  PageHeader + EmptyState components, button focus rings, inter via next/font
  (was never actually loading), font-feature tnum app-wide.

### Earlier — system structure + features (older PRs, summary only)

- **Finance** — admin-only via middleware + page-level requireAdmin (#16);
  per-officer + per-partner P&L tables (#17); cancel reversal nulls
  billed/paid + statusBeforeCancel snapshot for restore (#11); Recompute
  scoped to date range, excludes CANCELLED (#12).
- **Permissions** — middleware locks /finance to admin; `(app)/layout.tsx`
  is the defence-in-depth role gate reading `x-pathname` forwarded by
  middleware (#18 + #19 hotfix).
- **Schedules** — patrol/VPI cadence gained `timeOfDay`, `startsOn`,
  `endsOn`, `assignedOfficerId`, `intervalWeeks`, `exceptionDates`. Sync
  schedules button shows per-schedule diagnostics with reasons. (#9 + #10)
- **Auto-approve** — PATROL/VPI/LOCK/UNLOCK skip the review queue and go
  straight to APPROVED. ALARM_RESPONSE + KEY_* + ADHOC + SHIFT_CHECK still
  queue. (#11 + #14)
- **Keys** — KeySet got `photoUrl`. New /key-sets/[id] page with set
  editing, photo upload via @vercel/blob, bulk handover. Each key has
  /keys/[id]/edit. KeysTable has inline action links. (#15)
- **UI primitives skill** — `ui-ux-pro-max` skill installed at
  `~/.claude/skills/`. Used to guide the visual refresh.

### Numbered list (so the next chat can reference)

```
1  baseline (existing scaffold)
2  …
7  initial schema cleanup + auto-approve  (mint era)
8  patrol schedule extension
9  per-day time + starts-on
10 advanced schedule controls + sync diagnostics
11 nav cleanup + auto-approve + cancel reversal
12 finance: exclude CANCELLED + scope recompute
13 callout empty-state copy
14 LOCK + UNLOCK auto-approve
15 keys: edit + set page + photo + bulk handover
16 permissions lock-down + /finance/activities mirror
17 finance officer + partner breakdowns + detail pages
18 defence-in-depth role gate in (app) layout
19 hotfix /m/today redirect loop
20 design system upgrade (tokens, PageHeader, EmptyState, Inter)
21 site cleanup + key set click-through + Top Sites
22 brand-grounded visual refresh (mint era — gradient, ambient, etc.)
23 mint → BLUE brand swap (198 refs)
24 icons + toast + confirm + avatar + primitives
25 .table-default + StatusDot on dispatch
26 sweep remaining 9 tables
27 filter pills + animated KPIs + favicons + activity dots
28 m/today StatusDot + sweep native dialogs
29 fix CountUp closure staleness
30 revert CountUp on finance (diagnostic)
31 shifts in activities + review queue mobile + UK timestamps
32 shift KPI BST/GMT suffix
33 dispatch detail customer fallback
34 (skipped sequentially)
35 set Job.completedAt on auto-approve + backfill
36 orphan submissions in /activities + review-detail customer fallback
37 sort by scheduled date, not completedAt
38 sweep schedule-first sort across remaining pages
39 map arrivedAt → Job.startedAt + backfill
```

---

## Conventions to follow

### Design tokens (Tailwind config)

```ts
brand.blue      = #3B82F6      // primary accent
brand.blue-dark = #2563EB
brand.blue-light= #DBEAFE
brand.blue-{50..900}           // full scale
brand.navy      = #0F1929
brand.navy-{50..900}
success / warning / danger / info  // semantic
shadow-card / shadow-md / shadow-lg / shadow-lift / shadow-inner-highlight
bg-ambient                      // radial blue dust → slate gradient on body
bg-btn-primary-grad + hover
animation.shimmer / pop-in / pulse-dot
```

### CSS classes (globals.css — see file for full list)

Surfaces: `.card` / `.card-accent` / `.card-subtle` / `.card-hover` /
`.section` (= space-y-4). KPI: `.kpi` / `.kpi-label` / `.kpi-value` /
`.kpi-hint`. Buttons: `.btn-primary` / `.btn-secondary` / `.btn-ghost` /
`.btn-danger` / `.btn-dark`. Form: `.input` / `.label` / `.checkbox` /
`.radio`. Filter: `.pill-idle` / `.pill-active`. Chips: `.chip-mint` /
`.chip-slate` / `.chip-amber` / `.chip-red` / `.chip-info`. Table:
`.table-default` + `.col-num` for numeric cells. Empty: `.empty-state` /
`.empty-title` / `.empty-blurb` / `.skeleton`.

Global a11y baseline: every interactive element gets a `brand-blue/40`
focus-visible ring. `prefers-reduced-motion` shrinks every animation to
0.01ms.

### Activity sorting (PRs #37 + #38) — STRICT

Every activity list sorts by **schedule** then **arrival**, never
completion. The operator's mental model is the shift schedule (07:00 unlock,
09:00 VPI, 22:00 lock-up), not when paperwork closed.

| Source | `at` / `when` chain |
|---|---|
| PatrolVisit | `scheduledAt → arrivedAt → createdAt` |
| Job | `scheduledFor → startedAt → createdAt` |
| Shift | `scheduledStartsAt → actualStartedAt` |
| FormSubmission | `submittedAt` (no schedule field) |

Applies on `/activities`, `/finance/activities`, `/finance/officers/[id]`,
`/finance/partners/[id]`, `/sites/[id]` activity feed, `/dispatch` completed +
cancelled buckets. **Never** revert to completion-first ordering.

### Activity log scope

`/activities` (ops) loads:
- Visits with OR(`departedAt in range`, `scheduledAt in range`) — pending +
  scheduled + completed all visible.
- Jobs with OR(`completedAt in range`, `scheduledFor in range`).
- Shifts with `scheduledStartsAt in range`.
- Orphan FormSubmissions (`jobId IS NULL AND patrolVisitId IS NULL`) anchored
  on `submittedAt`.

`/finance/activities` (admin) keeps the COMPLETED-only filter — billing
counts finished work.

### Time + timezone

All operator-facing dates render in `Europe/London`. Use the `fmt()` helpers
or `Intl.DateTimeFormat({ timeZone: "Europe/London" })`. Datetime inputs use
`parseUkDateTimeLocal()` → `ukWallClockToUtc()` for storage; render back via
`toLocaleString({ timeZone: "Europe/London" })`. Body has
`font-feature-settings: "tnum"` so numbers don't dance — don't add
`tabular-nums` per-cell.

### Customer / Partner fallback

A Job or FormSubmission may carry `customerId` / `partnerId` directly OR
inherit from the site. Always fall back:
```ts
const customer = job?.customer ?? job?.site?.customer ?? null;
const partner  = job?.partner  ?? job?.site?.partner  ?? null;
```
Applied in `/dispatch/[id]` (PR #33), `/admin/reports/[id]` (PR #36), and
the activity log row mapping (already does this).

### Auto-approve rules

PATROL, VPI, LOCK, UNLOCK → status APPROVED on submission, `completedAt` set
from `data.departedAt`, `startedAt` set from `data.arrivedAt`. The
ReportReview row is APPROVED + reviewedAt = now so it never enters the
queue.

Other form types (ALARM_RESPONSE, KEY_COLLECTION, KEY_DROPOFF, ADHOC,
SHIFT_CHECK) stay PENDING and need admin review.

### Permissions

- Middleware: officers → `/m/*` + `/submit` only. Dispatchers → no
  `/finance/*`, no `/admin/*` except `/admin/reports/*`.
- `(app)/layout.tsx`: defence-in-depth re-check reading `x-pathname`
  forwarded by middleware. Fails open if `x-pathname` missing (avoids
  PR #18 → #19 redirect loop).
- Server actions: every admin action calls `requireAdmin()`; every staff
  action `requireStaff()`. Never trust middleware alone.

### Forms + dialogs

- `useConfirm()` for destructive actions — replaces `window.confirm`.
- `useToast()` for success/error feedback — replaces `window.alert`.
- The native dialogs still exist in 5 admin import panels (sites/nexus
  imports, geocode, reset). Sweep when touched.

### Tables

- Use `.table-default` on the `<table>`. Use `<thead>` + `<tbody>` plain;
  the class styles them.
- Right-align numeric columns with `.col-num` (= `text-right tabular-nums`).
- Wrap in `<div className="card overflow-x-auto">` for mobile horizontal
  scroll. Sticky header works inside `.card overflow-hidden` since the
  thead is `position: sticky`.

### Status dots

`StatusDot tone={...} pulse={...}` — tones map to:
- `live` = blue (in progress, syncing, on duty)
- `active` = green (completed / approved / closed / sent)
- `warn` = amber (late)
- `danger` = red (missed / cancelled)
- `muted` = slate (pending / idle)

`ActivityStatus` does the mapping from raw enum to dot. Use it everywhere a
Job/Visit status renders.

---

## Open + deferred

### Confirmed deferred (operator aware, lower priority)

- **Skeleton-via-Suspense** on `/finance` + `/activities` — would need to
  split each page into multiple Suspense islands. Skeleton primitives
  (SkeletonTable, SkeletonRow, SkeletonLine, SkeletonCard) are built and
  ready to use. The pages currently do a single big `await` up front.
- **Bulk actions** on `/activities` — multi-select checkboxes + sticky
  action bar (Cancel selected, Restore selected). Not built.
- **Logo bitmap** `/public/logo.jpg` still carries mint. Used to be the
  favicon (now SVG since PR #27), so this only affects legacy share
  previews. Worth regenerating in blue when convenient.
- **5 admin import panels** still use `window.confirm` (sites import,
  nexus import, geocode, reset). Rare admin surfaces; safe to sweep on
  the next touch.
- **PatrolVisit cancel/restore** — visits have no `CANCELLED` status in
  the enum. Cancel/restore works for Jobs only. Lock/unlock cron-created
  Jobs cancel/restore normally; only bare PatrolVisits (recurring patrols
  + VPI) lack the affordance.
- **Subcontractor cost** — `Job.paidAmount` is only set when there's an
  internal `assignedToUserId`. When a partner handles a job (Job.handledBy-
  PartnerId), we currently track what we billed the end customer but not
  what we owe the partner. `/finance/partners/[id]` calls this out in
  copy.
- **Sparklines in row cells** (officer P&L, partner P&L) — primitive
  exists; not wired.
- **Animated KPI count-up** — adopted on `/finance` (PR #27). Could
  extend to `/finance/officers/[id]`, `/finance/partners/[id]`,
  `/finance/payroll`. CountUp closure-staleness was fixed in PR #29.

### Things that just shipped (so the new chat doesn't double-fix)

- `Job.startedAt` mapped from form `arrivedAt` (PR #39) + backfill from
  `FormSubmission.arrivedAt`.
- `Job.completedAt` mapped from form `departedAt` on auto-approve (PR #35)
  + backfill from `Job.updatedAt`.
- Orphan FormSubmissions visible in `/activities` (PR #36).
- All activity sorts schedule-first (PRs #37 + #38).
- Customer/Partner fallback to site on `/dispatch/[id]` (PR #33) and
  `/admin/reports/[id]` (PR #36).
- Shift KPI cards show BST/GMT suffix (PR #32).
- Review queue is mobile-card on phones (PR #31).
- Shifts appear in `/activities` (PR #31).

### Known but not-yet-tackled feedback

- "Finance dashboard analytics should be better" — operator asked for
  "best performing sites", "site-wise / client-wise / officer-wise
  analytics" (PR #21 added Top Sites + Officers + Partners with the
  WE-did-for / THEY-did-for split). They may push for more granular
  drill-downs (e.g. month-over-month per site, profitability ranking,
  staff utilisation rate).
- "Whole new look" — visual refresh + brand swap shipped (#20-#28). If
  they say it still feels stale, the next logical lifts are dark mode +
  dashboards with embedded mini-charts (sparklines in row cells).

---

## House rules

1. **Never push without `npx tsc --noEmit` clean.**
2. **Always run `npm test` before committing.** Suite is 133 tests, must
   stay green.
3. **Migrations only via `prisma/migrations/<UTC timestamp>_<name>/`.**
   Never `prisma db push --accept-data-loss`. Build runs
   `prisma migrate deploy`.
4. **Match the schedule-first sort** on any new activity list — never
   sort by `completedAt` or `departedAt`.
5. **Use `useConfirm` + `useToast`** for any user feedback. No `window.*`.
6. **Admin-only by default for finance.** Middleware + page-level
   `requireAdmin()` + don't expose money fields outside `/finance/*`.
7. **Brand:** mint is dead. `brand-blue*` everywhere. If you see hex
   `#2FCB80` / `#27A86A` / `#E8F8EF`, it's a missed sweep — fix it.
8. **Don't tell the operator about deploy times.** Vercel takes ~2 min;
   they know.
9. **The operator is non-technical.** Don't ask them to run anything;
   ship via PR, merge, let Vercel deploy.

---

## Branch state right now

- Branch: `claude/review-chat-api-error-oVuda`
- Last commit: PR #39 merged to main (`9e90214`).
- Working tree: clean.
- Migrations applied: `20260608164404_backfill_job_startedat` (latest).
- 133 tests passing.
- Live URL: https://1st-nationwide-ops.vercel.app

If the next chat finds the working tree dirty, run `git pull --rebase` on
the feature branch first to align with whatever the operator merged from
the web UI.
