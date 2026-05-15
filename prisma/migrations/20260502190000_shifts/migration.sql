-- Shifts (static guarding, dog handler) + hourly check-in support.

ALTER TYPE "SubmissionForm" ADD VALUE 'SHIFT_CHECK';
ALTER TYPE "NotificationKind" ADD VALUE 'SHIFT_CHECK_OVERDUE';

CREATE TYPE "ShiftType" AS ENUM ('STATIC_GUARDING', 'DOG_HANDLER');
CREATE TYPE "ShiftStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
  'ABANDONED'
);

CREATE TABLE "Shift" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "siteId"            UUID         NOT NULL,
  "officerId"         UUID,
  "type"              "ShiftType"  NOT NULL,
  "scheduledStartsAt" TIMESTAMP(3) NOT NULL,
  "scheduledEndsAt"   TIMESTAMP(3) NOT NULL,
  "actualStartedAt"   TIMESTAMP(3),
  "actualEndedAt"     TIMESTAMP(3),
  "status"            "ShiftStatus" NOT NULL DEFAULT 'PENDING',
  "checkIntervalMin"  INTEGER      NOT NULL DEFAULT 60,
  "graceMinutes"      INTEGER      NOT NULL DEFAULT 15,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Shift_siteId_scheduledStartsAt_idx" ON "Shift"("siteId", "scheduledStartsAt");
CREATE INDEX "Shift_officerId_scheduledStartsAt_idx" ON "Shift"("officerId", "scheduledStartsAt");
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "User"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- Link form submissions to a shift (for hourly checks).
ALTER TABLE "FormSubmission" ADD COLUMN "shiftId" UUID;
CREATE INDEX "FormSubmission_shiftId_idx" ON "FormSubmission"("shiftId");

ALTER TABLE "FormSubmission"
  ADD CONSTRAINT "FormSubmission_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
