# 1st Nationwide Ops — System Documentation

Complete, module-by-module documentation of the platform, written so it can be understood, extended, or **rebuilt better**. This is the architecture reference; the setup checklists live one level up in [`../prod-setup.md`](../prod-setup.md) and [`../whatsapp-setup.md`](../whatsapp-setup.md).

Start with the **[Overview](./00-overview.md)** — especially §3 (the three-mode operating model), which is the concept most likely to be misunderstood in a rebuild.

## How these docs are organised

Every module doc follows the same shape, so you can skim consistently:

> **Purpose & scope → Data model → Key files → Core flows → Business rules & invariants → Entry points (actions/routes/crons) → Extension points & gotchas**

## Contents

| # | Doc | Covers |
|---|---|---|
| 00 | [Overview](./00-overview.md) | What it is, tech stack, architecture, the 3-mode operating model, roles, where to start. |
| 01 | [Data Model](./01-data-model.md) | All 46 models + 40 enums, grouped by domain; relationships; migration workflow. |
| 02 | [Access, Auth & Roles](./02-access-auth-roles.md) | NextAuth, the 5 roles, middleware + layout gating, rate limiting, duty tokens, admin bootstrap. |
| 03 | [Sites, Customers & Regions](./03-sites-customers-regions.md) | The site register, customers/contacts, access instructions, import & geocoding. |
| 04 | [Keys](./04-keys.md) | Keys, key sets, movements, holders, encrypted access codes. |
| 05 | [Patrols, Shifts & Rota](./05-patrols-shifts-rota.md) | Recurring patrol/lock-unlock schedules → materialised visits/jobs; guarding shifts + hourly checks; weekly rota. |
| 06 | [Dispatch, Jobs & Alarms](./06-dispatch-jobs-alarms.md) | The universal `Job` lifecycle, callouts (dispatcher + bot), alarms. |
| 07 | [Officer Reports & Forms](./07-officer-reports-forms.md) | The public `/submit` flow, dynamic form templates/blueprints, the review queue, client reports. |
| 08 | [Partners](./08-partners.md) | The three relationship modes in depth; partner officers, portal, rates. |
| 09 | [Finance: Billing, Rates & Pay](./09-finance-billing-pay.md) | Rate cards + overrides, per-activity billing snapshot, officer pay, payroll, P&L. |
| 10 | [Notifications](./10-notifications.md) | The unified queue → WhatsApp / SMS / Telegram broadcast; domain events; drainers; dedup. |
| 11 | [Telegram Bot](./11-telegram-bot.md) | Conversational dispatch assistant: AI intent router, tools, draft/confirm, linking. |
| 12 | [Integrations & Webhooks](./12-integrations-webhooks.md) | bOnline calls, geocoding, blob uploads, search, live location/map. |
| 13 | [Crons](./13-crons.md) | Every scheduled route: schedule, purpose, side effects. |
| 14 | [Conventions & UI System](./14-conventions-and-ui.md) | Dates/money, activity attribution, server-action pattern, UI primitives, a11y, testing. |
| 15 | [Deployment & Operations](./15-deployment-and-ops.md) | Build pipeline, env vars, migrations, bootstrap, seeding, runbook. |

## Suggested reading order for a rebuild

1. **[00 Overview](./00-overview.md)** → **[01 Data Model](./01-data-model.md)** → **[08 Partners](./08-partners.md)** — the load-bearing structure and the subtle business logic.
2. **[14 Conventions](./14-conventions-and-ui.md)** — the rules that keep the rebuild from drifting (timezones, attribution, money).
3. The domain you're touching: [06 Jobs](./06-dispatch-jobs-alarms.md), [05 Scheduling](./05-patrols-shifts-rota.md), [09 Finance](./09-finance-billing-pay.md), [07 Forms](./07-officer-reports-forms.md), …
4. The plumbing: [02 Auth](./02-access-auth-roles.md), [10 Notifications](./10-notifications.md), [13 Crons](./13-crons.md), [15 Deployment](./15-deployment-and-ops.md).

> **Tip:** `src/lib/*.test.ts` are the executable specification of the business rules — read them alongside these docs. Where a doc and the code disagree, the code (and its tests) win; please fix the doc.
