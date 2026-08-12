# Conventions & UI System

> The shared rules, primitives, and patterns every module relies on — dates, money, UI components, accessibility, and testing.

## Purpose & scope

Cross-cutting concerns that aren't a "module" but are load-bearing everywhere. A rebuild that ignores these will drift into subtle timezone bugs, inconsistent money display, and inaccessible screens.

## Dates & times — `src/lib/dates.ts`

**Rule: never format a date inline; never construct a wall-clock time with `new Date(y,m,d,…)` on the server.** Vercel runs in UTC, so naive construction stores the wrong instant. Everything routes through this module.

| Function | Use |
|---|---|
| `formatDate` / `formatDateTime` / `formatTime` | Human display, en-GB, Europe/London. Return `"—"` for null. |
| `formatTimeAgo` | Relative ("5m ago"), falls back to a date past ~6 days. |
| `toIsoDate` / `parseIsoDate` | `YYYY-MM-DD` for `<input type=date>` / URL params (local, DST-safe). |
| `ukDayString` / `daysFromTodayUk` | Which **UK** calendar day an instant falls on; powers Today/Yesterday/Tomorrow labels. |
| `ukWallClockToUtc` / `parseUkDateTimeLocal` / `formatUkDateTimeLocal` | Convert `<input type=datetime-local>` values ↔ UTC correctly across BST/GMT. **Use `parseUkDateTimeLocal` in every server action that reads a datetime-local field.** |

## Money & numbers — `src/lib/numbers.ts`

- `formatMoney(amount, {currency})` — `Intl.NumberFormat` GBP, `"—"` for null.
- `formatNumber(value, opts)` — locale grouping.
- Money is stored as Prisma `Decimal`; convert with `Number(x)` at the edge. Always pair figures with `tabular-nums` in the UI.

## Activity attribution — `src/lib/activityWhen.ts`

The canonical helpers for **when** an activity "belongs" — by **scheduled date, then completion, never `createdAt`**. `jobScheduledRange` / `visitScheduledRange` / `shiftScheduledRange` build the date-window `where` fragments; `jobWhen` / `visitWhen` / `shiftWhen` give the display instant. Every date-scoped loader (dispatch feeds, activity lists, Telegram schedule queries, PDF reports) uses these so a back-dated entry never shows on the wrong day.

## Server-action pattern

- Mutations are **server actions** in a `_actions.ts` file (`"use server"`), guarded by an `authz` helper (`requireStaff`/`requireAdmin`/`requirePartner`).
- They return a small result object (`{ ok, error?, fieldErrors? }` — see `src/lib/actionResult.ts`) or `redirect()`.
- Reusable "core" logic that must run without an auth context (from the bot or a cron) lives in `src/lib/*` (e.g. `jobActions.ts` exposes `reassignJobCore`/`cancelJobCore`/`closeJobCore`/`completeVisitCore`; the UI actions and the bot both delegate to them).
- Side effects (notifications, PDF, geocode) are fired `.catch()`-guarded and never block the action's result.
- `src/lib/audit.ts` writes `ActivityLog` rows for significant mutations.

## UI system — `src/app/globals.css` + `tailwind.config.ts`

**Brand tokens**: `brand-blue` `#3B82F6` (primary), `brand-navy` `#0F1929` (dark), plus semantic `success/warning/danger`. Light-mode only (`color-scheme: light`).

**Primitives** (`@layer components`) — compose these, don't reinvent:

| Class | What |
|---|---|
| `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger` / `.btn-dark` | Buttons. 44px min-height on touch, natural on desktop; explicit transitions; focus-visible ring. |
| `.input` `.label` `.checkbox` `.radio` | Form controls. **`.input` is 16px on mobile** (`text-base md:text-sm`) to stop iOS focus-zoom. |
| `.card` / `.card-accent` / `.card-subtle` / `.card-hover` | Surfaces. |
| `.kpi` / `.kpi-value` / `.kpi-label` | Dashboard metric cards. |
| `.table-default` / `.col-num` | Standard list table (sticky header, tabular numeric column). |
| `.pill` / `.chip-*` | Filter pills / status chips. |
| `.empty-state` / `.skeleton` | Empty + loading states. |

**Utilities** (`@layer utilities`): `.pt-safe*` / `.pb-safe*` (notch/home-indicator insets; the root viewport sets `viewport-fit: cover`), `.table-scroll` (horizontal scroll wrapper for wide tables), `.cv-row` / `.cv-card` (`content-visibility` — the browser skips off-screen rows in long lists; applied by `DataTable`/`MultiSelect` past 50 items).

**Shared components** (`src/components/`): `TopNav`/`PartnerTopNav`/`PartnerOfficerTopNav`, `DataTable` (responsive table→cards, server-rendered), `Pagination` (URL `?page=`, preserves filters), `FilterPanel`/`FilterPills`/`MultiSelect` (URL-synced filters), `Confirm` (promise-based modal, focus-trapped — replaces `window.confirm`), `Toast` (with Undo), `CommandPalette` (⌘K global search via `/api/search`), `PageHeader`, `EmptyState`, `Skeleton`, `BrandLogo`, `StatusDot`, `TimeAgo`, `TrendChart`/`Sparkline`/`BarList`/`CountUp` (server-rendered charts), `map/MapInner` (Leaflet).

## Accessibility — Vercel Web Interface Guidelines

The repo installs Vercel's guidelines: always-on rules in root [`AGENTS.md`](../../AGENTS.md), and a `/web-interface-guidelines <file>` audit command (`.claude/commands/`). Baked-in baselines: global `:focus-visible` ring, a `prefers-reduced-motion` reset, `aria-live` on async status, associated form labels, 44px touch targets, `Intl` dates/numbers, skip-to-content links. Run the audit on any new screen.

## Testing & verification

- **Unit tests**: `vitest` — the business-logic libs have `*.test.ts` next to them (`billing`, `dates`, `payroll`, `patrolDates`, `shiftChecks`, `telegramCallout`, `formTemplates`, `nexusImport`, `bonline`, `crypto`, `ratelimit`, `entityColor`, `geo`, `dayActivitiesFormat`). **These are the executable spec — treat them as the source of truth for the rules.**
- **The green-before-ship pipeline** (run all three):
  ```
  node_modules/.bin/tsc --noEmit
  node_modules/.bin/vitest run
  SKIP_ENV_VALIDATION=1 node_modules/.bin/next build
  ```

## Other shared libs worth knowing

- `src/lib/db.ts` — the Prisma singleton (avoid connection exhaustion).
- `src/lib/crypto.ts` — AES encryption of alarm/padlock access codes (`ENCRYPTION_KEY`).
- `src/lib/ratelimit.ts` — Upstash/KV limiter (no-op if KV unset).
- `src/lib/entityColor.ts` / `labels.ts` — deterministic colour + human labels for entities.
- `src/lib/geo.ts` / `geocode.ts` — geofence maths + postcode/what3words geocoding.
