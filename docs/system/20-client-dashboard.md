# 20 — Client dashboard

## Purpose & scope

A direct customer's own read-only view of the work we do for them, at `/client`. Built first for Shurgard (October 2026). It shows:

- **Overview**: activity counts and charges for a period, by type and by site.
- **Activity log**: every activity at their sites (callouts, lock-ups and unlocks, static guarding shifts, patrols and VPIs) with its status and charge. Each opens its own page, with times, the alarm details and the officer's report (answers, photos, signature) or a shift's check-ins. It can be downloaded as CSV.
- **Reports**: the daily report PDF for any day from 1 Sept 2026 (the same format as the daily email, but their sites only), and the list of activities that have a report. A shift's page offers its shift report PDF.
- **Charges**: charges by period and site, and their invoices (sent or paid, never drafts or voids) with what's still owed and a PDF download.
- **Sites**: each site's activity and charges.

**Sign-in is by emailed link — no passwords.** Anyone whose email domain is on the customer's list (Shurgard: `shurgard.co.uk`, `shurgard.com`) can ask for a link at `/login/client`. Admins manage the domains, see who has signed in, block people and preview the dashboard under **Admin → Customers → (customer) → Client dashboard**.

The old shared email + password client login (one per customer, set on the same page) is gone. A client user that already has a password can still sign in at `/login` until blocked.

## Data model

Migration `20261023120000_client_dashboard_email_links`, additive. It also sets Shurgard's domains (owner's choice).

| Model / field | Notes |
|---|---|
| `Customer.portalEmailDomains String[]` | Domains whose addresses may sign in, lower case, exact match. Empty = sign-in off. A domain may belong to one customer only (checked on save). |
| `ClientLoginLink` | One emailed link: `tokenHash` (SHA-256 of the token — the token itself is never stored), `email`, `customerId`, `expiresAt` (15 min), `usedAt`. |
| `User.lastLoginAt` | Last sign-in to the dashboard. |
| `User` with `role = CUSTOMER`, `customerId` | Made the first time someone uses a link; `active = false` blocks them. |

## Key files

| File | Responsibility |
|---|---|
| `src/lib/clientLogin.ts` | Domain rules, link creation and email (`requestClientLink`), `peekClientLink`, `consumeClientLink` (uses the link once, makes or loads the user). |
| `src/lib/auth.ts` | The `client-link` NextAuth credentials provider. |
| `src/lib/authz.ts` | `getClientScope` / `requireCustomer`: the one customer every portal query is scoped to; re-checks the user row each request so a block bites at once; admin preview. |
| `src/lib/clientPreview.ts` | Preview cookie name (edge-safe, used by middleware). |
| `src/app/login/client/*` | Public sign-in page, "check your email", and the `verify` page with its **Sign in** button. |
| `src/lib/clientPortal.ts` | Activity list (with charge, type, report flag), summaries, invoices (`invoiceState`). |
| `src/lib/clientActivityDetail.ts` | One activity's page data: times, charge, alarm, reports, check-ins, photos. |
| `src/lib/clientReports.ts` | Which parts of a report payload a client sees (`clientReportBody`). |
| `src/lib/clientCsv.ts` | Activity log CSV. |
| `src/app/client/*` | The pages; downloads under `src/app/client/download/*` (CSV, daily report, shift report, invoice). |
| `src/app/(app)/admin/customers/[id]/_components/ClientDashboardCard.tsx` + `_actions.ts` | Domains, link to send, preview, people with block / unblock. |

## Core flows

### Signing in

1. **Request** (`/login/client`, server action `requestLink`): rate-limited per IP (`clientLinkLimiter`, 10 / 15 min). `requestClientLink`:
   - checks the domain is on an active customer's list;
   - refuses staff emails, another customer's users and blocked users;
   - allows at most 3 links per address per 15 minutes;
   - stores the token's hash and emails the link (Resend, `lib/email.ts`). Without email configured it logs the link in development only.

   The page always answers "Check your email", so it never reveals who may sign in.
2. **Verify** (`/login/client/verify?token=…`): shows the address and a **Sign in** button. Opening the link doesn't use it up, so mail scanners that follow links can't spend it. Expired or used links show "This link has expired".
3. **Sign in**: the button calls `signIn("client-link", { token })`. `consumeClientLink` marks the link used (one atomic update), re-checks the domain and that the customer is active, then loads or creates the CUSTOMER user and stamps `lastLoginAt`. The session is the usual NextAuth JWT (30 days).

### Every request

- `middleware.ts`:
  - CUSTOMER sessions see only `/client/*`.
  - Signed-out visitors to `/client` go to `/login/client`, not the staff sign-in.
  - An ADMIN reaches `/client` only while previewing.
- The client layout and every page/download call `getClientScope()`/`requireCustomer()`. Every query is scoped through `site: { is: { customerId } }` (or `customerId` for invoices), never a URL value.
- A blocked user is sent to `/login/client?off=1`.

### Preview

The **Preview their dashboard** button sets an httpOnly cookie with the customer's id (2 hours) and opens `/client`. The layout shows a "Preview" banner and **Exit preview**. The cookie counts only for an ADMIN session.

## Business rules & invariants

- **Client-safe data only.** Money is what we charge the client (`billedAmount`, ex VAT), per activity and summed. Invoice totals include VAT.
- **Never shown**:
  - officer pay;
  - subcontractor costs (`partnerChargeToUsAmount`);
  - rates or margin;
  - internal notes (`Job.notes`, visit notes, alarm notes);
  - access/alarm codes;
  - GPS fixes or geofence distances;
  - import bookkeeping.
- **Officer identity**: none in lists. An activity page shows the officer's report as filed, which can include the officer's name if the form asks for it (as the FastField report the client already gets does). The shift report PDF names the officer, as before.
- **Reports**: `clientReportBody` keeps answers (with the form template's labels), photos and the signature. It drops our own keys (`gps`, `distanceM`, `withinGeofence`, `slotIndex`, `source`, `fastfield`, anything starting `_`, …) and anything that isn't a plain answer. FastField reports show their answers via `FastFieldAnswers`.
- **What's listed**: the same as before — cancelled jobs, and missed or late visits and missed or abandoned shifts, are not shown. An activity page for anything else (or another customer's) is a 404.
- **Daily report**: `loadShurgardReport(day, now, { customerId })` — the customer's own sites only. The staff/emailed Shurgard report still adds Access Storage's static guarding.

## Extension points & gotchas

- **Email must be configured** (`RESEND_API_KEY`, `EMAIL_FROM` on a verified domain), or no link is sent. The server log says "Client sign-in link not sent: email isn't configured" — with no address in it.
- **A domain is all-or-nothing**: anyone with a mailbox there can sign in. Block individuals on the admin card; remove the domain to turn sign-in off. Blocking takes effect on the person's next page.
- **Another customer**: add their domains on their admin page. The dashboard works for any customer; the daily report uses the Shurgard format (callouts/lock-ups + static guarding).
- **Adding something to the dashboard**: select explicit fields only, scope by the customer, and never pass a raw payload to the page — go through `clientReportBody`.
