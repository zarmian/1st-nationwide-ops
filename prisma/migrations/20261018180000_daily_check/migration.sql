-- Daily check: one row per morning run, plus a single settings row.
-- Additive only.

CREATE TABLE "DailyCheck" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd"   TIMESTAMP(3) NOT NULL,
  "findings"    JSONB        NOT NULL,
  "counts"      JSONB        NOT NULL,
  "overview"    TEXT,
  "trigger"     TEXT         NOT NULL,
  "emailedTo"   TEXT,
  "emailedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DailyCheck_trigger_createdAt_idx" ON "DailyCheck"("trigger", "createdAt");

CREATE TABLE "DailyCheckSettings" (
  "id"         INTEGER      NOT NULL DEFAULT 1,
  "enabled"    BOOLEAN      NOT NULL DEFAULT true,
  "recipients" TEXT,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyCheckSettings_pkey" PRIMARY KEY ("id")
);
