-- Admin-managed picker labels for the JobType and JobSource enums.
-- See src/lib/labels.ts and /admin/options. The enums themselves are
-- unchanged — Job.type and Job.source still reference them. These
-- tables just hold renamable/reorderable display labels keyed by the
-- enum code so admins can adjust dropdowns without a code deploy.
--
-- Idempotent seeding from JOB_TYPE_DEFAULTS / JOB_SOURCE_DEFAULTS in
-- labels.ts happens on first visit to /admin/options
-- (ensureOptionsSeeded). This migration only creates the empty tables.

CREATE TABLE "JobTypeOption" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "code"        "JobType"    NOT NULL,
  "label"       TEXT         NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER      NOT NULL DEFAULT 100,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobTypeOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobTypeOption_code_idx" ON "JobTypeOption"("code");
CREATE INDEX "JobTypeOption_active_sortOrder_idx"
  ON "JobTypeOption"("active", "sortOrder");


CREATE TABLE "JobSourceOption" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "code"        "JobSource"  NOT NULL,
  "label"       TEXT         NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER      NOT NULL DEFAULT 100,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobSourceOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobSourceOption_code_idx" ON "JobSourceOption"("code");
CREATE INDEX "JobSourceOption_active_sortOrder_idx"
  ON "JobSourceOption"("active", "sortOrder");
