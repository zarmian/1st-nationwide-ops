-- Backfill Job.startedAt from the linked FormSubmission.arrivedAt.
--
-- The auto-approve and submit paths used to ignore data.arrivedAt
-- (only mapping data.departedAt → completedAt), so every job that
-- went through /submit before today has startedAt = NULL even
-- though the officer entered an arrival time. The data is still
-- there on FormSubmission.arrivedAt; this migration copies it back
-- onto the Job.
--
-- Joins on FormSubmission.jobId. Only touches rows where Job.startedAt
-- is null AND the submission has arrivedAt, so it's safe to re-run
-- (idempotent) and never overwrites a real value.

UPDATE "Job" j
SET "startedAt" = sub."arrivedAt"
FROM "FormSubmission" sub
WHERE sub."jobId" = j.id
  AND j."startedAt" IS NULL
  AND sub."arrivedAt" IS NOT NULL;
