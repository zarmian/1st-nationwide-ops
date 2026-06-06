-- Backfill Job.completedAt for already-approved jobs.
--
-- The auto-approve path in /api/submissions used to set status =
-- APPROVED but leave completedAt NULL. That hid the job from
-- /finance/activities (which scopes by completedAt) and prevented the
-- billing snapshot from being attributed to the right date.
--
-- Use updatedAt as the best available approximation of when the job
-- was approved — that's the timestamp Prisma touched on the
-- status flip.

UPDATE "Job"
SET "completedAt" = "updatedAt"
WHERE "completedAt" IS NULL
  AND status IN ('APPROVED', 'CLOSED', 'SENT_TO_CLIENT');
