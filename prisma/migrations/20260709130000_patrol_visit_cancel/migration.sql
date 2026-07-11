-- Patrol visits can now be cancelled (mirrors Job cancel/restore).
--
-- 1. VisitStatus gains CANCELLED.
-- 2. PatrolVisit gets the cancellation audit columns.
--
-- Note: we only ADD the enum value here (no row uses it in this migration),
-- so Postgres' "can't use a new enum value in the same transaction" rule is
-- not triggered.

ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "PatrolVisit"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "statusBeforeCancel" "VisitStatus";
