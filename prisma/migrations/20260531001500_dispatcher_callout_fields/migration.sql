-- Dispatcher-recorded callouts: schema additions on "Job".
--
-- Adds two columns + one foreign key to "Job":
--   recordedByUserId       -> User (SetNull) — who entered the callout
--   excludeFromClientReport BOOLEAN NOT NULL DEFAULT false
--
-- Both are additive and safe on existing rows:
--   - recordedByUserId is nullable; existing rows keep NULL.
--   - excludeFromClientReport has a server-side default of false, so
--     every existing Job is treated as "include" (no behaviour change
--     for the daily client report).
--
-- The corresponding Prisma relation:
--   User.jobsRecorded Job[] @relation("JobRecordedBy")
-- is a virtual relation field — no DB column is created for it.

ALTER TABLE "Job"
  ADD COLUMN "recordedByUserId"        UUID,
  ADD COLUMN "excludeFromClientReport" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
