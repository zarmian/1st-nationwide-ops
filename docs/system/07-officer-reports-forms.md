# Officer Reports & Forms

> The public `/submit` officer-report flow, its admin-defined dynamic form templates/blueprints, the submission → review → client-report pipeline, and the activities/Shurgard report exports.

## Purpose & scope

- Give any officer (staff or outside subcontractor, **no login required**) one permanent URL to file a report against a site + job type.
- Let admins define **what** each report asks for, per customer/partner/site, without a deploy (`FormTemplate` + `FormBlueprint`, JSON field definitions).
- Route submissions through an admin review queue and, for direct-customer jobs, queue a customer-facing `ClientReport`.
- Produce staff-facing activity/Shurgard exports (PDF/CSV) off the same activity data.
- **Out of scope / cross-refs:** the `Job`/`PatrolVisit`/`Shift` records a submission completes → [`06-dispatch-jobs-alarms.md`](./06-dispatch-jobs-alarms.md); billing/pay snapshots triggered on submit/approve → [`09-finance-billing-pay.md`](./09-finance-billing-pay.md); the alarm-ack SMS + notifications → [`10-notifications.md`](./10-notifications.md); the three partner modes that decide whether a submission/report exists at all → [`08-partners.md`](./08-partners.md).

## Data model

Source: `prisma/schema.prisma`. Money is `Decimal(10,2)`; all ids are `uuid` unless noted.

### Enums

| Enum | Values | Notes |
|---|---|---|
| `SubmissionForm` | `ALARM_RESPONSE`, `PATROL`, `LOCK`, `UNLOCK`, `KEY_COLLECTION`, `KEY_DROPOFF`, `VPI`, `ADHOC`, `SHIFT_CHECK` | The report kind. `SHIFT_CHECK` is used only by shift-linked check-ins, not offered in the `/submit` picker. |
| `TemplateScope` | `GLOBAL`, `CUSTOMER`, `PARTNER`, `SITE` | Resolution precedence, most-specific first. |
| `ReviewStatus` | `PENDING`, `APPROVED`, `REJECTED`, `EDITED_AND_APPROVED` | `EDITED_AND_APPROVED` set when the reviewer changed any field before approving. |
| `ReportChannel` | `EMAIL`, `PORTAL_DOWNLOAD`, `WHATSAPP` | Only `EMAIL` is written today. |
| `ReportStatus` | `PENDING`, `SENT`, `FAILED`, `CANCELLED` | **Nothing transitions a `ClientReport` out of `PENDING`** — see gotchas. |

### Models

**`FormTemplate`** — the resolvable, active form an officer fills.
- `name`; `jobType SubmissionForm?` (**null = "any job type"**); `scope TemplateScope`.
- Target FKs, all nullable, cascade-delete with their parent: `customerId`, `partnerId`, `siteId`.
- `fields Json @default("[]")` — array of field defs (see field schema below).
- `blueprintId String?` (SetNull) — provenance only; not re-read at submit time.
- `active Boolean @default(true)` — only active templates resolve.
- `createdById` → `User` (author). Back-relation `submissions FormSubmission[]`.
- Indexed on `[scope, jobType, active]`, plus each target FK.

**`FormBlueprint`** — reusable **starting point** for templates (not resolved at submit time).
- `slug @unique`, `name`, `description?`, `jobType SubmissionForm?`, `fields Json`, `source String?` (e.g. "FastField form 549243"), `builtin Boolean`, `active Boolean`.
- Back-relation `templates FormTemplate[]`.

**`FormSubmission`** — one officer report.
- `form SubmissionForm`; `formTemplateId?` (SetNull) — null when no template matched.
- Activity links, all nullable, all SetNull: `siteId`, `jobId`, `patrolVisitId`, `shiftId`. A submission can exist with only a site.
- `submittedByUserId?` (null for anonymous officers); `officerNameRaw String` (**always** captured, even when logged in).
- `arrivedAt?`, `departedAt?` — officer's on-/off-site times.
- `payload Json @default("{}")` — validated, coerced answer map keyed by field `key`.
- `review ReportReview?` (1:1).

**`ReportReview`** — the admin sign-off record (created for **every** submission).
- `submissionId @unique` (cascade); `status ReviewStatus @default(PENDING)`.
- `reviewerId?` → `User`; `reviewedAt?`; `reviewerNotes?` (internal, never shown to client).
- `edits Json?` — `{ field: { from, to } }` diff of reviewer changes.
- `clientReports ClientReport[]`.

**`ClientReport`** — a queued customer deliverable.
- `reviewId` (cascade); `channel ReportChannel @default(EMAIL)`; `toAddress String`; `subject?`; `pdfUrl?`; `status ReportStatus @default(PENDING)`; `sentAt?`; `failureReason?`.

### Field-definition schema (`src/lib/formTemplates.ts`)

`fields` JSON is an array validated by `FieldDefSchema` / `FieldsArraySchema` (Zod):
- `key` (lowercase snake, unique per template), `label`, `type`, `required`, `options?`, `helpText?`, `defaultValue?`, `meta?.maxCount` (photos).
- 14 `FIELD_TYPES`: `text`, `textarea`, `checkbox`, `select`, `number`, `date`, `time`, `datetime`, `tri`, `location`, `section`, `signature`, `multiphoto`.
- `section` is a non-input divider (label only, auto key `section_\d+`). `select` must have ≥1 option. Max 40 fields.
- Tri-state encoding: `0=No, 1=Yes, 2=N/A` (`TRI_LABELS`).
- Stored payload shapes: `location` → `{lat,lng,accuracy?,capturedAt?}`; `signature` → blob URL string; `multiphoto` → `[{url,name}]`.

## Key files

- `src/lib/formTemplates.ts` — field schema, `FIELD_TYPES`, `SUBMISSION_FORM_LABEL`, server `resolveTemplate` (see gotcha), `parseFields`, `validatePayload`, tri labels. Unit test: `src/lib/formTemplates.test.ts`.
- `src/app/submit/page.tsx` — public server component; loads active sites + **all** active templates + prefill from `?jobId/?visitId/?shiftId/?siteId`.
- `src/app/submit/SubmitForm.tsx` — client form: site/type pickers, per-type `FieldInput` renderer, **client-side** `resolveTemplate` (the one actually used), geolocation-on-submit, POSTs to `/api/submissions`.
- `src/app/submit/_components/PhotoGrid.tsx` / `SignaturePad.tsx` — direct-to-blob uploaders via `@vercel/blob/client`.
- `src/app/api/submissions/route.ts` — POST handler: validate, create submission + review, cascade activity/finance side-effects.
- `src/app/api/blob/upload-token/route.ts` — issues scoped Vercel Blob upload tokens (public, rate-limited).
- `src/app/(app)/admin/reports/page.tsx` — review queue (PENDING + REJECTED).
- `src/app/(app)/admin/reports/[id]/page.tsx` — review detail (payload render, times, billing, approve/reject).
- `src/app/(app)/admin/reports/_actions.ts` — `approveReview`, `rejectReview`.
- `src/app/(app)/admin/reports/[id]/_components/ReviewActions.tsx` — approve/reject client forms.
- `src/app/(app)/admin/forms/**` — template list/new/edit; `_actions.ts` (create/update/duplicate/delete), `_components/FormTemplateForm.tsx`, `FieldEditor.tsx`.
- `src/app/(app)/admin/blueprints/**` — blueprint list/new/edit; `_actions.ts`, `_components/BlueprintForm.tsx` (reuses `FieldEditor`).
- `src/lib/reports/activitiesReport.ts` — shared activity-row loader (jobs+visits+shifts merge). `ActivitiesReportPdf.tsx` renders it.
- `src/app/api/reports/activities/route.ts` (PDF), `src/app/api/activities/export/route.ts` (CSV) — staff exports.
- `src/lib/reports/shurgardReport.ts` + `src/app/api/reports/shurgard/route.ts` + `ShurgardReportPdf.tsx` — daily Shurgard PDF (on demand).

## Core flows

### A. Officer submits a report
1. **Open** `GET /submit` (public — whitelisted in `middleware.ts`). `SubmitPage` (`submit/page.tsx`) loads all active sites and all active templates, plus any prefill from `?jobId/?visitId/?shiftId`. Officer name pre-fills from session if logged in, else `?officerName`.
2. **Pick** site + job type in `SubmitForm`. `resolveTemplate(siteId, formType, sites, templates)` (client, `SubmitForm.tsx:709`) selects the winning template purely client-side from the preloaded set (see resolution rules below).
3. **Render** each field via `FieldInput` by `type`. `tri` renders 3 buttons; `location` calls `navigator.geolocation`; `signature`/`multiphoto` mount the blob uploaders.
4. **Upload media** (if any): `PhotoGrid`/`SignaturePad` call `upload()` → `POST /api/blob/upload-token`, which validates `siteId` + content-type + 15 MB cap and returns a scoped token; the file lands under `uploads/…` and its public URL is stored in the field value.
5. **Submit**: `onSubmit` grabs a best-effort GPS fix (8 s timeout, never blocks), then `POST /api/submissions` with `{siteId, jobId?, patrolVisitId?, shiftId?, form, formTemplateId?, officerNameRaw, arrivedAt?, departedAt?, lat?, lng?, payload}`. A shift-linked submit forces `form = "SHIFT_CHECK"`.
6. **Server** (`api/submissions/route.ts`): rate-limits anonymous callers (`submissionLimiter`); Zod-parses the body; verifies the site is active; if `formTemplateId` set, re-loads the template, asserts `jobType` matches (or is null), and runs `validatePayload(fields, payload)` — coercing/validating each field, rejecting with `fieldErrors` on failure. **Payload is only validated when a template id is present.**
7. **Persist**: create `FormSubmission`; create its `ReportReview`. **Auto-approve** (`status=APPROVED`, `reviewedAt=now`) for `PATROL | VPI | LOCK | UNLOCK`; everything else lands `PENDING`.
8. **Cascade side-effects** (best-effort, non-blocking):
   - Linked `Job` → `APPROVED` (auto forms) or `SUBMITTED`; maps `arrivedAt→startedAt`, `departedAt→completedAt`; stamps GPS. Auto forms call `snapshotJobFinanceIfNeeded` (`src/lib/billing.ts`).
   - Linked `PatrolVisit` → `COMPLETED`; fires `notifyVisitCompleted`; snapshots visit billing + officer pay via `billForSite`/`payForOfficer` anchored on `scheduleDate`.
   - Linked `Shift` → stamps GPS only.
9. Response `{ok, id}`; `SubmitForm` shows the "Report submitted" card with a "Submit another" reset.

### B. Admin reviews & queues the client report
1. `/admin/reports` (`admin/reports/page.tsx`) lists reviews with `status ∈ {PENDING, REJECTED}`, oldest first.
2. `/admin/reports/[id]` renders the submission: site, customer/partner (falling back to the site's account for cron-created jobs), arrived/departed, matched billing, and a typed `FragmentRow` render of every payload key (tri labels, signature `<img>`, photo grid, location → Google-Maps link).
3. **Approve** (`ReviewActions.ApproveForm` → `approveReview` in `_actions.ts`): re-checks role is `ADMIN|DISPATCHER`; parses optional edits to officer name / arrived / departed; computes `edits` diff; in a transaction updates the submission (if edited), sets review `APPROVED` or `EDITED_AND_APPROVED`, and — **only if `job && !job.reportedViaPartnerApp && job.customer?.contactEmail`** — creates a `PENDING` `ClientReport` (`channel=EMAIL`, `toAddress=customer email`, generated `subject`). Moves the `Job` to `APPROVED`. Outside the tx: `snapshotJobFinanceIfNeeded`, and for opted-in alarm customers `notifyAlarmCustomerAck`. Redirects to `/admin/reports`.
4. **Reject** (`rejectReview`): requires a ≥3-char reason; sets review `REJECTED` + `reviewerNotes`; no `Job`/`ClientReport` change. Rejected rows stay in the queue.

### C. Template & blueprint authoring
1. `/admin/blueprints/new` → `createBlueprint` (unique slug enforced) stores a reusable field set.
2. `/admin/forms/new` shows a **BlueprintPicker** (`?from=<id>` or `?from=blank`); chosen blueprint's fields pre-fill the `FormTemplateForm`. `createTemplate` validates scope↔target coherence (CUSTOMER needs customerId, etc.) and `FieldsArraySchema`, then redirects to edit.
3. Edit uses `updateTemplate`; `duplicateTemplate` clones fields but resets scope→GLOBAL and `active=false`; `deleteTemplate` **soft-deletes (deactivates)** if any submissions reference it, else hard-deletes.

### D. Activity / Shurgard exports (read-only)
1. `loadActivitiesReportRows(params)` (`activitiesReport.ts`) merges `PatrolVisit` + `Job` + `Shift`, each anchored on its **scheduled** date (`activityWhen.ts`), applies customer/partner/officer/site/region/kind/status filters, normalises to `ActivityReportRow[]`, sorts desc.
2. `GET /api/reports/activities` → PDF (staff; no money columns; defaults status to `completed`). `GET /api/activities/export` → CSV (**admin only**; includes billed/paid).
3. `GET /api/reports/shurgard?date=` → `loadShurgardReport` groups Shurgard callouts/lock-unlocks by site (labels e.g. "Norbury (Lock and Unlock)", "(Nexus)" for subcontracted) + static-guarding shifts → PDF.

## Business rules & invariants

- **`/submit` is public** and the POST is rate-limited only for anonymous callers. The blob token route is public + rate-limited and enforces `siteId` active + content-type + 15 MB.
- **Resolution order = SITE → CUSTOMER → PARTNER → GLOBAL**, first active match wins; within a scope an **exact `jobType` match beats a null (any) template**. Implemented twice (see gotchas).
- **Every submission gets exactly one `ReportReview`.** Auto-approved kinds (`PATROL/VPI/LOCK/UNLOCK`) skip the queue; the rest need admin sign-off.
- **A `ClientReport` is created only at manual approval, and only for direct-customer jobs** — `job` present, `!reportedViaPartnerApp`, `job.customer.contactEmail` set. Auto-approved forms therefore never yield a client report (they never hit `approveReview`). Partner-app jobs never do either.
- **`officerNameRaw` is always stored** (the human-typed name), independent of `submittedByUserId`.
- Payload values are validated **only when a `formTemplateId` accompanies the submission**; a template-less submission saves raw `payload` untouched (name + times are still captured).
- Template `jobType` on a submission must match the posted `form` (or be null), else 400.
- `deleteTemplate`/`deleteBlueprint` never destroy history: anything referenced (submissions / templates) or `builtin` is deactivated instead of deleted.
- Activity attribution is by **scheduled date, never `createdAt`** — a backdated entry lands on the day it was for.
- All display times are Europe/London wall-clock via `src/lib/dates.ts`; the review detail explicitly avoids raw UTC.

## Entry points

**Public routes**
- `GET /submit` (`submit/page.tsx`) — the officer form (SSR data load + prefill).
- `POST /api/submissions` (`api/submissions/route.ts`) — create submission + review + cascade side-effects.
- `POST /api/blob/upload-token` (`api/blob/upload-token/route.ts`) — scoped Vercel Blob upload token.

**Server actions**
- `admin/reports/_actions.ts` — `approveReview`, `rejectReview` (role `ADMIN|DISPATCHER`).
- `admin/forms/_actions.ts` — `createTemplate`, `updateTemplate`, `duplicateTemplate`, `deleteTemplate` (`requireAdmin`).
- `admin/blueprints/_actions.ts` — `createBlueprint`, `updateBlueprint`, `deleteBlueprint` (`requireAdmin`).

**Staff export routes (GET, `ADMIN`/`DISPATCHER`)**
- `/api/reports/activities` (PDF), `/api/activities/export` (CSV, admin-only), `/api/reports/shurgard` (PDF).

**Crons:** none in this module. No cron sends `ClientReport`s (see gotchas).

## Extension points & gotchas

- **Two `resolveTemplate` implementations.** The **client** one in `SubmitForm.tsx` is what `/submit` actually uses (it filters the preloaded template list). The **server** `resolveTemplate` in `formTemplates.ts` (DB-querying) is exported/tested but **not called by any route** — reserved/dead. A rebuild should collapse to one server resolver and stop shipping every template to the browser.
- **`ClientReport` never sends.** Rows are created `PENDING` and nothing flips them to `SENT/FAILED` — there is no send cron and no `pdfUrl` writer. The daily Shurgard email is still a placeholder; the Shurgard/activities PDFs are on-demand downloads only. Approving direct-customer reports silently accrues `PENDING` rows.
- **UI↔action mismatch on report eligibility.** `admin/reports/[id]/page.tsx` computes `reportable` and the "will be queued to X" banner using `job?.customer ?? sub.site?.customer` (site fallback), but `approveReview` only creates a `ClientReport` when **`job.customer`** has an email — a cron-created site-only job (no `job.customerId`) shows the banner yet produces no report.
- **Auto-approve set is hard-coded** in `api/submissions/route.ts` (`PATROL/VPI/LOCK/UNLOCK`), not data-driven — changing which kinds skip review needs a code change.
- **Blob orphans**: uploaded files are referenced only inside the submission payload; abandoned uploads under `uploads/` are swept by the retention cron, not tracked in the DB.
- **`isBlobUrl` accepts any `https://` URL** (`formTemplates.ts`) — signature/photo validation trusts the client URL because the token route is the real gate. Preserve that server-side lockdown if you change uploaders.
- **`SHIFT_CHECK`** is a first-class `SubmissionForm` but is never selectable in `/submit`; it is forced only when a `shiftId` is present. Field editors omit it from their job-type lists.
- Adding a field **type** touches four places: `FIELD_TYPES` + `validatePayload` (`formTemplates.ts`), `FieldInput` render (`SubmitForm.tsx`), `FieldEditor` (`admin/forms/_components`), and the `FragmentRow` render (`admin/reports/[id]/page.tsx`).
