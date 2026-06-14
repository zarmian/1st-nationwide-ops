-- Backfill Job.customerId / Job.partnerId from the parent Site when the
-- Job was created at a time the site hadn't yet been assigned an
-- account. When admin sets Site.customerId or Site.partnerId after the
-- fact, existing Jobs from that site still carry NULL — that makes
-- them show up as "Unassigned" on the finance dashboard until an
-- explicit update.
--
-- This one-shot migration copies the site's owner onto each affected
-- Job so finance aggregates line up immediately. Safe to re-run (the
-- WHERE clauses no-op once the column is set). Untouched jobs that
-- legitimately have no site (shift-detached, recorded callout with no
-- site) remain unaffected — those keep NULL.

UPDATE "Job" j
SET "customerId" = s."customerId"
FROM "Site" s
WHERE j."siteId" = s.id
  AND j."customerId" IS NULL
  AND s."customerId" IS NOT NULL;

UPDATE "Job" j
SET "partnerId" = s."partnerId"
FROM "Site" s
WHERE j."siteId" = s.id
  AND j."partnerId" IS NULL
  AND s."partnerId" IS NOT NULL;
