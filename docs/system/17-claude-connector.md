# 17 — Claude connector (MCP)

## Purpose & scope

Lets an admin (and, if switched on, office staff) connect **Claude** — claude.ai on the web, the Claude desktop and mobile apps, and Claude Code — to this system, then ask questions in plain English: "what's happening tonight?", "which Shurgard visits were missed last week?", "who holds the keys for Camden?", "how did alarm response times look this month?", "who's owed money?".

It is a remote **MCP server** at `/api/mcp`, protected by the app acting as its **own OAuth 2.1 authorisation server**. It is **read-only by design**: there is no tool that creates, changes or deletes anything, and there is no write scope.

What Claude never gets, by construction (the tools never select these fields):

- `AccessInstruction` — alarm/padlock codes (encrypted *and* legacy plaintext columns), lockbox ids, entry steps, hazards
- `User.passwordHash`, Telegram link codes/chat ids, `Shift.publicToken` (duty links), `Shift.linkPhone`
- `AlarmEvent.rawBody` (only zone + subject are shared)
- Money for office staff (finance, compliance and the customer/partner directory are admin-only tools)

## How someone connects

1. Admin → **Claude** (`/admin/claude`) shows the address to paste: `https://1st-nationwide-ops.vercel.app/api/mcp`.
2. In Claude: **Customize → Connectors → Add custom connector**, name *1st Nationwide Ops*, paste the address. If Claude asks how it should identify itself, pick **Use Claude's published identity**, and leave the OAuth client ID and secret empty.
3. **Connect** → Claude opens `/oauth/authorize` → sign in with the 1NW login → **Allow**.

Who may connect: active **ADMIN** accounts always; **DISPATCHER** ("Office") accounts only when an admin ticks *Let office staff connect Claude* on `/admin/claude` (`McpSettings.allowDispatchers`, off by default). Officers, partners and client-portal logins never can. This is re-checked on **every** token exchange and **every** MCP request, so deactivating a user, changing their role or switching the office toggle off cuts Claude off immediately.

## Data model

All in `prisma/schema.prisma` (migration `20261011120000_claude_connector`).

| Model | What it is |
|---|---|
| `McpGrant` | One "Allow": user, client (`clientId` = CIMD URL, `clientName`), `redirectHost`, `scope`, `resource`, `lastUsedAt`, `revokedAt`/`revokedByUserId`. Revoking it kills every code/token under it. |
| `McpAuthCode` | Single-use authorisation code (5 min): `codeHash`, `redirectUri`, S256 `codeChallenge`, `usedAt`. |
| `McpToken` | `ACCESS` (1 h) / `REFRESH` (30 days, rotated on every use) bearer tokens; `tokenHash`, `expiresAt`, `revokedAt`. |
| `McpToolCall` | Audit trail: who (user, grant), which tool, the filters used, ok/error, duration. Shown on `/admin/claude`. |
| `McpSettings` | Single row (id 1): `allowDispatchers`. Missing row = defaults. |

Codes and tokens are random 256-bit values with recognisable prefixes (`1nw_code_`, `1nw_at_`, `1nw_rt_`); **only their SHA-256 hashes are stored**.

## Key files

| File | Role |
|---|---|
| `src/lib/mcp/config.ts` | Origin/issuer/resource URLs (from `NEXTAUTH_URL`), scope, lifetimes, RFC 8414 + RFC 9728 metadata, the `WWW-Authenticate` challenge. |
| `src/lib/mcp/clients.ts` | Client ID Metadata Documents: only Anthropic's (`https://claude.ai/oauth/...`, `claude.com`) are accepted; fetch + validate + cache, built-in fallback copies; redirect-URI rules (Anthropic https callback, or loopback with any port). |
| `src/lib/mcp/oauth.ts` | Authorize-request checks, approve/deny, code exchange with PKCE, refresh rotation + reuse detection, revocation, `verifyAccessToken` (resource-server side), who-may-connect. |
| `src/lib/mcp/server.ts` | Builds the `McpServer` per request: registers the tools (admin-only ones only for admins), read-only annotations, server instructions, audit logging, friendly errors. |
| `src/lib/mcp/tools/*` | The tool implementations (reuse of the app's own loaders/rules — see below). |
| `src/app/api/mcp/route.ts` | The MCP endpoint: bearer check → 401 + `WWW-Authenticate` when missing/invalid; stateless Streamable HTTP with JSON responses (`WebStandardStreamableHTTPServerTransport`); GET/DELETE → 405. |
| `src/app/.well-known/oauth-authorization-server/route.ts` | RFC 8414 metadata. |
| `src/app/.well-known/oauth-protected-resource/(api/mcp/)route.ts` | RFC 9728 metadata (root and path-suffixed). |
| `src/app/oauth/authorize/page.tsx` | Consent screen (sign-in redirect, who/what/where, Allow/Cancel). |
| `src/app/api/oauth/authorize/route.ts` | Receives Allow/Cancel; CSRF-checked; redirects back to Claude with `code` + `state` + `iss`. |
| `src/app/api/oauth/token/route.ts` · `revoke/route.ts` | Token endpoint (form-encoded; `authorization_code`, `refresh_token`) and RFC 7009 revocation. |
| `src/app/(app)/admin/claude/*` | Admin page: how to connect, office toggle, connections (Disconnect), latest 50 lookups. |

## The OAuth flow (what Claude does)

1. `POST /api/mcp` without a token → **401** with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp", scope="ops:read"`.
2. Claude reads the protected-resource metadata (`resource` = the MCP URL, `authorization_servers` = [the app origin]) and then `/.well-known/oauth-authorization-server`.
3. Because the AS metadata advertises `client_id_metadata_document_supported: true` **and** `token_endpoint_auth_methods_supported: ["none"]`, Claude uses its **Client ID Metadata Document** (`https://claude.ai/oauth/mcp-oauth-client-metadata`; Claude Code uses `.../claude-code-client-metadata`). There is deliberately **no `registration_endpoint`** (no open Dynamic Client Registration), so if a user picks *Register automatically* in Claude's dialog the connection fails — they must use the published identity.
4. Browser → `/oauth/authorize?response_type=code&client_id=<CIMD URL>&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...&resource=...`.
   - Unknown client or a redirect URI not in Anthropic's document → error page, **never** a redirect.
   - Protocol errors (no S256 PKCE, wrong `resource`, `response_type` ≠ `code`) → redirect back with `error` + `state` + `iss`.
   - Not signed in → `/login?callbackUrl=...` and back.
5. **Allow** posts to `/api/oauth/authorize` → `McpGrant` + `McpAuthCode` → 303 to Claude's callback with `code`, `state`, `iss` (RFC 9207).
6. `POST /api/oauth/token` (`application/x-www-form-urlencoded`) with `code_verifier` → access + refresh token. Errors are RFC 6749 codes (`invalid_grant` for any bad/used/expired code or refresh token).
7. Claude calls `/api/mcp` with `Authorization: Bearer …`, refreshing up to 5 minutes before expiry (refresh tokens rotate; the old one stops working at once).

Claude caches the discovery documents for about 5 minutes; changes to them take that long to reach everyone.

## Tools

All tools are annotated `readOnlyHint: true`, `destructiveHint: false` (so Claude can run them without per-call confirmation), have a `title`, and return JSON text. Dates in and out are **UK** (`YYYY-MM-DD`; times as UK local with offset, e.g. `2026-10-11T19:30+01:00`).

| Tool | Who | What it reuses / mirrors |
|---|---|---|
| `get_operations_overview` | Admin, Office | Dispatch board buckets (`ukDayStart`, overdue = open/assigned before today), one UK day's work by status (scheduled-date rule), open alarms (last 24 h, `computeAlarmSla`), officers on duty. |
| `list_activities` | Admin, Office | Activities log: `jobScheduledRange`/`visitScheduledRange`/`shiftScheduledRange`, job filters on `Job.customerId/partnerId`, visit/shift filters via the site, `STATUS_GROUPS`, `KIND_LABEL`. Up to 93 days; earliest first; exact totals by status. |
| `get_activity` | Admin, Office (money admin-only) | One job / patrol visit / shift by id, alarm id or partner reference (`LINK-…`, `J…`): times, people, notes, alarm + SLA, `proofVerdict` (GPS vs geofence). |
| `list_alarms` | Admin, Office | `/alarms`: `AlarmEvent.priority`, received → on site, `summariseAlarmSla`; UK days on `receivedAt` (default last 7 days). |
| `search_sites` | Admin, Office | `/sites` filters (`buildSiteWhereAnd`). |
| `get_site` | Admin, Office | Site profile **without** `AccessInstruction`; schedules, key sets + holders, customer contacts, last 14 days + next 7 days of work. |
| `find_keys` | Admin, Office | `/keys`: status, holder (`office` = held by 1NW), latest handover. |
| `list_officers` | Admin, Office | `/officers`: region, phone, on duty, last seen, SIA status (`statusFor`). |
| `get_compliance` | **Admin** | `/compliance` (`loadComplianceRegister`). |
| `list_accounts` | **Admin** | `/admin/customers` + `/admin/partners` with contacts. |
| `get_finance_summary` | **Admin** | `/finance/pnl` (`loadPnl`) + `/finance/receivables` (`loadReceivables`); default this month to date. |
| `list_invoices` | **Admin** | Receivables rows for outstanding/overdue; the invoice list otherwise. |
| `review_fastfield` | **Admin** | `/admin/fastfield`: reports filed in a window (default 30 days) by status — robot vs by hand (`Linked by …` / `… created by …` notes) — and, for each waiting one, a dry run of the import's own `decide()` under today's rules (preview, nothing written), the site typed vs matched, and work at that site within 24 h (or the nearest site to the GPS fix). No report answers. `reviewFastField` in `lib/fastfieldImport.ts`. |

Name filters (site, customer, partner, officer, region) accept part of a name; results report which names matched, and a filter that matches nothing returns a readable error. The admin-only **hidden accounts** declutter applies exactly as in the app: to ops tools only for admins, and always to finance.

## Business rules & invariants

- **Read-only.** No tool writes anything except its own audit row. Adding write actions needs a new scope, `destructiveHint` annotations, consent-screen wording and a deliberate decision — not a quiet extra tool.
- **Never select `AccessInstruction`** (or password/token fields) in a tool. Use explicit `select`s, never `include` on `Site`/`User`/`Shift`.
- **Dates mean the scheduled UK day** (house rule) — use `resolveDayRange` / `parseUkDay` from `tools/common.ts` (strict: `2026-13-45` is rejected, not rolled over).
- **Role parity with the app:** a person sees through Claude no more than their own login shows them. Admin-only tools aren't even listed for office staff.
- **Logs stay data-free:** tool errors are logged by message only; the audit trail lives in the database (`McpToolCall`), not in Vercel logs.

## Security notes

- Only Anthropic's clients can be authorised; codes only ever go to `https://claude.ai/...`/`claude.com` callbacks or a loopback address (Claude Code on the user's own machine — the consent screen warns about this).
- PKCE S256 is mandatory; codes are single-use (a replayed code revokes the whole connection); refresh tokens rotate and a long-delayed reuse of a rotated token revokes the connection; tokens are audience-bound to `/api/mcp` (RFC 8707).
- Consent screen: `X-Frame-Options: DENY` + `frame-ancestors 'none'` (clickjacking), `Referrer-Policy: same-origin`; the Allow POST must carry a same-site `Origin` (or `Referer`) **and** the session (NextAuth cookies are `SameSite=Lax`).
- Rate limits: `oauthLimiter` (60/min per IP) on token/revoke/consent posts, `mcpLimiter` (240/min per connection) on `/api/mcp` — active only when the Upstash/KV env vars are set.
- Data sent to Claude is processed by Anthropic. Only connect Claude accounts the company controls.

## Entry points

`/api/mcp` · `/oauth/authorize` · `/api/oauth/authorize` · `/api/oauth/token` · `/api/oauth/revoke` · `/.well-known/oauth-authorization-server` · `/.well-known/oauth-protected-resource[/api/mcp]` · `/admin/claude` (+ `_actions.ts`: `disconnectClaude`, `setOfficeStaffClaude`).

## Extension points & gotchas

- **`NEXTAUTH_URL` must be the public URL** — it's the issuer and the resource (`<NEXTAUTH_URL>/api/mcp`). The resource must equal exactly what users paste into Claude.
- **Adding a tool:** implement it in `src/lib/mcp/tools/`, register it in `server.ts` via `tool(...)` (it inherits the read-only annotations, audit and error handling), add its label to `TOOL_LABEL` in `/admin/claude/page.tsx`, document it above, and extend the local rehearsal (see below).
- **If Anthropic changes its client documents:** `clients.ts` accepts any `https://claude.ai|claude.com/oauth/...` document that validates; the built-in copies are only a fallback for the two known URLs.
- **Middleware:** `middleware.ts` excludes `api/mcp`, `api/oauth` and `oauth` (and `/.well-known/*` via the dot rule) — keep it that way if middleware is moved/fixed; these routes do their own auth.
- **Testing:** unit tests in `src/lib/mcp/**/*.test.ts`. The full rehearsal used before shipping ran a production build against a local Postgres with the demo seed: discovery, sign-in redirects, consent per role, CSRF refusals, code/PKCE/replay/rotation/revocation, every tool through the official MCP client, and a scan of all tool output for the seeded access codes, password hashes and duty tokens (none present).
