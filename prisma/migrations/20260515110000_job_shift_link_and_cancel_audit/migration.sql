-- Link Job ↔ Shift, audit job cancellations.
--
-- Adds three columns + two foreign keys + one index to "Job":
--   shiftId            -> Shift (SetNull)
--   cancelledAt
--   cancelledByUserId  -> User (SetNull)
--
-- Existing FormSubmission_jobId_fkey was already created with SET NULL
-- in the initial migration, so no change needed there — the Prisma
-- schema file just got brought back in sync with reality.

ALTER TABLE "Job"
  ADD COLUMN "shiftId"           UUID,
  ADD COLUMN "cancelledAt"       TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" UUID;

CREATE INDEX "Job_shiftId_idx" ON "Job"("shiftId");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
