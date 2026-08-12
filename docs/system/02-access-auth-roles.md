# Access, Auth & Roles

> How a request is authenticated (NextAuth credentials + JWT), how five roles are gated at three layers (middleware → layout → server-action guard), plus the admin bootstrap, rate limiting, per-entity audit log, and the tokenised officer duty link.

## Purpose & scope

Everything that decides **who a request is** and **what it may reach**:

- NextAuth v4 credentials login, JWT session, session augmentation (`role`, `partnerId`).
- The five `UserRole` values and the surfaces each may see.
- Defence-in-depth route gating: `middleware.ts` (primary) → `(app)` / `partner` layouts (server re-check) → `requireX()` guards inside every server action / API route (backstop).
- One-time admin bootstrap (`/api/admin/init`).
- IP rate limiting for public endpoints (`src/lib/ratelimit.ts`).
- Per-entity audit trail (`src/lib/audit.ts` → `ActivityLog`).
- Unguessable duty-link tokens for accountless shift running (`src/lib/tokens.ts`, `src/lib/dutyLink.ts`).

Sibling docs: [`00-overview.md`](./00-overview.md) (roles table §4), [`08-partners.md`](./08-partners.md) (why partner scoping matters), [`10-notifications.md`](./10-notifications.md) (the `SHIFT_LINK` notification), [`13-crons.md`](./13-crons.md) (`CRON_SECRET` gating — a separate mechanism from user auth), [`15-deployment-and-ops.md`](./15-deployment-and-ops.md) (env vars).

## Data model

| Model / enum | Where | Notes |
|---|---|---|
| `enum UserRole` | `prisma/schema.prisma:20` | `ADMIN`, `DISPATCHER`, `OFFICER`, `PARTNER`, `PARTNER_OFFICER`. |
| `User` | `prisma/schema.prisma:~370` | `passwordHash String?` (bcrypt), `active Boolean` (login gate), `role UserRole`, `partnerId String?` (set for `PARTNER` / `PARTNER_OFFICER`). Contact columns used by notifications: `phone`, `whatsappNumber`, `telegramChatId @unique`. |
| `PartnerOfficer` | `prisma/schema.prisma:~500` | Roster row linked 1:1 to a `PARTNER_OFFICER` `User` via `userId`; carries `partnerId` + `active`. Resolved on every partner-officer request (see `requirePartnerOfficer`). |
| `ActivityLog` | `prisma/schema.prisma` | Audit rows: `entity`, `entityId`, `action`, `userId?`, `diff Json?`. Written by `logActivity`. |
| `Shift.publicToken` | `prisma/schema.prisma:1299` | `String? @unique` — the duty-link credential. |

### Role → surface map

| Role | Home | Allowed surfaces | Denied |
|---|---|---|---|
| `ADMIN` | `/dispatch` | Everything (dispatch, sites, finance, admin, review queue). | — |
| `DISPATCHER` | `/dispatch` | Dispatch, sites, `/admin/reports` review queue. | `/finance/*`, rest of `/admin/*`. |
| `OFFICER` | `/m/today` | `/m/*`, `/submit`. | Everything else (hard-locked). |
| `PARTNER` | `/partner` | `/partner/*` **except** `/partner/m/*`. | Staff app, dispatch, finance, admin, sites. |
| `PARTNER_OFFICER` | `/partner/m/today` | `/partner/m/*` only. | Partner-admin pages and all staff pages. |

`partnerId` is **null** for `ADMIN` / `DISPATCHER` / `OFFICER` and **set** for the two partner roles. It is the tenant key: partner queries must be scoped by the session's `partnerId`, never a URL value.

## Key files

| File | Responsibility |
|---|---|
| `src/lib/auth.ts` | `authOptions`: credentials provider, JWT strategy, `jwt`/`session` callbacks that stamp `id`/`role`/`partnerId`. |
| `src/app/api/auth/[...nextauth]/route.ts` | Mounts NextAuth as `GET`/`POST` (`/api/auth/*`). |
| `src/types/next-auth.d.ts` | Module augmentation: adds `id`/`role`/`partnerId` to `Session.user`, `User`, and `JWT`. |
| `src/lib/authz.ts` | Server guards: `getSessionUser`, `requireUser`, `requireAdmin`, `requireStaff`, `requirePartner`, `requirePartnerOfficer`. |
| `middleware.ts` | Edge role gate + `x-pathname` forwarding (primary enforcement). |
| `src/app/(app)/layout.tsx` | Staff shell — server-side role re-check (defence-in-depth). |
| `src/app/partner/layout.tsx` | Partner + partner-officer shell — session/role/partner re-check; picks nav. |
| `src/app/api/admin/init/route.ts` | One-time admin bootstrap from env vars. |
| `src/lib/ratelimit.ts` | Upstash/KV sliding-window limiters + `checkLimit` / `clientKey`. |
| `src/lib/audit.ts` | `logActivity` + `diffFields` → `ActivityLog`. |
| `src/lib/tokens.ts` | `newPublicToken()` — 32-byte base64url CSPRNG token. |
| `src/lib/dutyLink.ts` | `dutyUrl(token)` — absolute `/duty/<token>` URL from `NEXTAUTH_URL`. |
| `src/lib/cronAuth.ts` | `isAuthorisedCron` — **not** user auth; documented in [`13-crons.md`](./13-crons.md). |

## Core flows / mechanics

### Login → session (`src/lib/auth.ts`)

1. `CredentialsProvider.authorize()` lower-cases + trims the email, `findUnique`, and **rejects** when: no user, no `passwordHash`, or `!active`. Then `bcrypt.compare`. On success returns `{ id, email, name, role, partnerId }`.
2. Session strategy is **JWT**, `maxAge` **30 days**; sign-in page `/login`.
3. `jwt` callback copies `id`/`role`/`partnerId` onto the token — but only when `user` is present (i.e. at sign-in). `partnerId` is deliberately **sticky on the JWT** to avoid a DB hit on every `/partner/*` request; it only refreshes on the next sign-in.
4. `session` callback mirrors `token.id/role/partnerId` onto `session.user`.

**Session shape** (augmented in `next-auth.d.ts`):

```ts
session.user = { id: string; role: UserRole; partnerId?: string | null;
                 name; email; image }   // last three from DefaultSession
```

### Guard helpers (`src/lib/authz.ts`)

All **throw** on failure (server actions turn thrown errors into a generic 500; prefer returning an `ActionResult.fail()` for richer UX — see [`14-conventions-and-ui.md`](./14-conventions-and-ui.md)).

| Guard | Passes when | Returns / notes |
|---|---|---|
| `getSessionUser()` | — | `SessionUser \| null` (null if no `id`/`role`). |
| `requireUser()` | signed in | `SessionUser`; else `"Sign in required"`. |
| `requireAdmin()` | `role === ADMIN` | else `"Not authorised"`. |
| `requireStaff()` | `ADMIN` or `DISPATCHER` | else `"Not authorised"`. |
| `requirePartner()` | `role === PARTNER` **and** `partnerId` set | returns `SessionUser & { partnerId: string }` — a **guaranteed-non-null** `partnerId` callers MUST use to scope every Prisma `where`. Trusts the session, never the URL. |
| `requirePartnerOfficer()` | `role === PARTNER_OFFICER` **and** `partnerId` set | does **one extra DB round-trip**: loads the `PartnerOfficer` seat by `userId`, then checks it exists, is `active`, and `seat.partnerId === session.partnerId` (defence against a roster row reparented since the JWT was issued). Returns `& { partnerId, partnerOfficerId }`. Not cached on the JWT to avoid stale-link risk on re-link/deactivate. |

### Three-layer route gating (defence-in-depth)

**Layer 1 — `middleware.ts` (primary, edge).** Wraps `withAuth`. Reads `req.nextauth.token.role`, forwards the current path as an `x-pathname` request header (so layouts can gate without re-parsing the URL), then applies redirects:

- **Unauthenticated** (`!role`) → pass through; `withAuth`'s `signIn` redirect (`/login`) handles it.
- **OFFICER hard-lock** → only `/m`, `/m/*`, `/submit`, `/submit/*`; anything else → `/m/today`.
- **PARTNER hard-lock** → `/partner` + `/partner/*` **except** `/partner/m/*`; else → `/partner`.
- **PARTNER_OFFICER hard-lock** → `/partner/m` + `/partner/m/*` only; else → `/partner/m/today`.
- **Staff on `/partner/*`** (no `partnerId`) → bounced to `homeFor(role)`.
- **`/admin/*`** → admin-only **except** `/admin/reports[/*]` (dispatcher review queue).
- **`/finance[/*]`** → admin-only.
- `homeFor()`: `OFFICER→/m/today`, `PARTNER→/partner`, `PARTNER_OFFICER→/partner/m/today`, else `/dispatch`.

**Matcher** (bottom of `middleware.ts`) excludes — i.e. leaves **public / self-guarding** — these prefixes: `api/auth`, `api/blob`, `api/webhooks`, `api/telegram`, `_next/static`, `_next/image`, `login`, `submit`, `duty`, `jobs`, `offline`, `robots`, `sitemap`, and any path with a file extension. `api/blob` and `api/webhooks` are excluded because they verify their own credentials (scoped upload token / shared secret) and must accept anonymous callers.

**Layer 2 — layout re-check (server).**
- `src/app/(app)/layout.tsx`: `getServerSession` → `redirect("/login")` if none. Reads `x-pathname`; re-applies the same role rules (OFFICER off `/m|/submit` → `/m/today`; `PARTNER` → `/partner`; `PARTNER_OFFICER` → `/partner/m/today`; `DISPATCHER` on `/finance` or non-reports `/admin` → `/dispatch`). **Fails open when `x-pathname` is missing** (trusts middleware) to avoid an infinite redirect loop.
- `src/app/partner/layout.tsx`: `getServerSession` → `/login`; role must be `PARTNER`/`PARTNER_OFFICER` (else bounce to staff home); `partnerId` required (else `/login`); loads the `Partner` and requires `active`; for `PARTNER_OFFICER` additionally loads the `PartnerOfficer` seat by `userId` and requires it `active`. Chooses `PartnerTopNav` vs `PartnerOfficerTopNav` by role. **`/partner/m/*` has no separate layout** — it is served by this same file.

**Layer 3 — action/route guards.** Every mutating server action and protected API route calls `requireAdmin` / `requireStaff` / `requirePartner` / `requirePartnerOfficer`. This is the true security boundary: even if a request bypasses the matcher (stale cache, edge hiccup), the action throws.

### Admin bootstrap (`src/app/api/admin/init/route.ts`)

`GET /api/admin/init?secret=<INIT_SECRET>` — `force-dynamic`, idempotent:

1. Rate-limited by `adminInitLimiter` keyed on `clientKey(req)` → `429` + `Retry-After` when exceeded.
2. `500` if `INIT_SECRET` env missing; `403` if `secret` query mismatch.
3. `500` if `ADMIN_EMAIL` / `ADMIN_PASSWORD` env missing.
4. If any `role: ADMIN` user already exists → returns `{ status: "already_exists" }` (no-op).
5. Else `bcrypt.hash(password, 10)`, create `User` (`role: ADMIN`, `active: true`) → `{ status: "created" }`.

`/api/admin/seed-demo` reuses the same `adminInitLimiter` + `clientKey` pattern.

### Rate limiting (`src/lib/ratelimit.ts`)

- Backed by Upstash Redis / Vercel KV (`KV_REST_API_URL/TOKEN` **or** `UPSTASH_REDIS_REST_URL/TOKEN`). **If neither pair is set, limiters are `null` and `checkLimit` returns `{ allowed: true }`** — dev/preview fail open.
- Sliding-window algorithm; `analytics: false`.

| Limiter | Prefix | Budget | Enforced at |
|---|---|---|---|
| `submissionLimiter` | `submit` | 30 / 60 s / IP | `POST /api/submissions` (officer report) and `/jobs` claim action (`claim:<ip>` key). |
| `uploadTokenLimiter` | `upload` | 60 / 60 s / IP | `POST /api/blob/upload-token`. |
| `adminInitLimiter` | `admin-init` | 5 / 600 s / IP | `/api/admin/init`, `/api/admin/seed-demo`. |

`clientKey(req)`: first token of `x-forwarded-for` (or `x-real-ip`), else `"anon"`. `checkLimit` → `{ allowed: true } | { allowed: false, retryAfterSeconds }`.

### Audit log (`src/lib/audit.ts`)

- `logActivity({ entity, entityId, action, userId?, diff?, client? })` writes one `ActivityLog` row. `userId` is `null` for token/officer actions with **no account** (e.g. duty-link edits). Pass a `client` (`Prisma.TransactionClient`) to log inside the same transaction as the change.
- `diffFields(before, after)` builds `{ field: { from, to } }` for **changed keys only**: `Date`s compared by timestamp, everything else by JSON equality; `Date`s normalised to ISO strings in the stored diff.
- Purpose: the "anything edited after the job is done shows in the log, with who and when" requirement on shifts. Example: `sendShiftLink` logs `action: "link_sent"` with `diff: { sentTo }`.

### Duty-link tokens (accountless shift running)

- `newPublicToken()` = `randomBytes(32).toString("base64url")` (~43 chars, CSPRNG). Far beyond brute-forceable; **the link is the only credential** and opens exactly one shift.
- On shift creation (`src/app/(app)/shifts/_actions.ts`) `Shift.publicToken` (unique) is set. `sendShiftLink` texts `dutyUrl(token)` via SMS and records a `SHIFT_LINK` notification row (see [`10-notifications.md`](./10-notifications.md)).
- `/duty/[token]` is **public** (middleware-excluded). The officer starts / checks in / ends the shift there with no login; those mutations live in `src/app/duty/[token]/_actions.ts` and log to `ActivityLog` with `userId: null`. The `IN_PROGRESS` + check-in cadence they drive is swept by the `shift-checks` cron ([`13-crons.md`](./13-crons.md)).
- `dutyUrl` derives its base from `NEXTAUTH_URL` (fallback `VERCEL_URL`); it lives outside any `"use server"` module so non-action code can import it.

## Business rules & invariants

- **`active = false` blocks login** (`authorize` rejects) and excludes a user from every notification recipient query.
- **Email is normalised** (`toLowerCase().trim()`) at login and at bootstrap — store emails lower-cased.
- **`partnerId` is authoritative from the session only.** Never scope partner data by a route param; always use the value returned by `requirePartner` / `requirePartnerOfficer`.
- **Partner-officer seat is re-validated per request** (existence + `active` + `partnerId` match) — the JWT is not trusted for it.
- **`requireStaff` = ADMIN ∪ DISPATCHER**; **`requireAdmin` = ADMIN only.** Finance and the non-reports admin area are ADMIN-only at all three layers.
- **Middleware redirects are UX, not security** — the guard inside the action is the boundary. A page with no guarded action is only as safe as the matcher.
- **Admin bootstrap is single-shot**: once one `ADMIN` exists it never creates another.
- **Duty tokens are unique and unrevocable except by rotation** — regenerating `publicToken` invalidates the old link.

## Entry points

| Trigger | Path |
|---|---|
| Sign in / out / session | `/api/auth/*` → `src/app/api/auth/[...nextauth]/route.ts` |
| Login page | `/login` |
| Admin bootstrap | `GET /api/admin/init?secret=…` |
| Public officer form | `/submit` (rate-limited POST `/api/submissions`) |
| Public open-jobs claim | `/jobs` |
| Public shift runner | `/duty/[token]` |
| Blob upload token | `POST /api/blob/upload-token` (self-guarding, rate-limited) |
| Server-side session read | `getSessionUser()` / `requireX()` from `src/lib/authz.ts` |

## Extension points & gotchas

- **Adding a role** means touching all three layers: `UserRole` enum + migration, `authorize`/callbacks (if it carries new claims), `middleware.ts` (`homeFor` + a hard-lock block), both layouts, and new `requireX` guards. Miss the guard and the role is unprotected regardless of middleware.
- **`partnerId` staleness:** because it is sticky on the 30-day JWT, re-parenting or unlinking a partner seat is **not** reflected until the next sign-in — hence `requirePartnerOfficer` re-checks the seat live. If you add partner-admin claims, decide the same trade-off consciously.
- **Rate limiters silently no-op without KV/Upstash env** — safe for dev, but a production deploy that forgets those env vars has **no** abuse protection on `/submit`, uploads, or `/api/admin/init`. See [`15-deployment-and-ops.md`](./15-deployment-and-ops.md).
- **`x-pathname` fail-open:** the `(app)` layout intentionally skips its gate if the header is absent. Don't "harden" this to fail closed without solving the `/m/today` redirect-loop it prevents.
- **New public route?** It must be added to the middleware `matcher` exclusion **and** must do its own auth (secret, token, or rate limit) — the matcher only removes the session requirement, it does not add protection.
- **NextAuth v4 + App Router**: session augmentation is compile-time only (`next-auth.d.ts`); a runtime claim not set in both the `jwt` and `session` callbacks will be `undefined` even though TypeScript says it exists.
- **Cron auth is separate** (`CRON_SECRET` Bearer, `src/lib/cronAuth.ts`) and does not use NextAuth at all — see [`13-crons.md`](./13-crons.md).
