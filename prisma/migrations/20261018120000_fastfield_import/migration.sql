-- FastField import: the FastField forms (and which client each reports for)
-- and the submissions imported from them, linked to the activity they were
-- attached to. Additive only — no existing table changes.

CREATE TYPE "FastFieldReportStatus" AS ENUM ('LINKED', 'CREATED', 'UNMATCHED', 'IGNORED');

CREATE TABLE "FastFieldForm" (
  "formId"     INTEGER      NOT NULL,
  "name"       TEXT         NOT NULL,
  "customerId" UUID,
  "enabled"    BOOLEAN      NOT NULL DEFAULT false,
  "createJobs" BOOLEAN      NOT NULL DEFAULT false,
  "jobType"    "JobType"    NOT NULL DEFAULT 'ALARM_RESPONSE',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FastFieldForm_pkey" PRIMARY KEY ("formId")
);
ALTER TABLE "FastFieldForm" ADD CONSTRAINT "FastFieldForm_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FastFieldReport" (
  "id"               UUID                    NOT NULL DEFAULT gen_random_uuid(),
  "submissionId"     TEXT                    NOT NULL,
  "formId"           INTEGER                 NOT NULL,
  "submittedAt"      TIMESTAMP(3)            NOT NULL,
  "startedAt"        TIMESTAMP(3),
  "finishedAt"       TIMESTAMP(3),
  "submittedBy"      TEXT,
  "officerText"      TEXT,
  "siteText"         TEXT,
  "lat"              DOUBLE PRECISION,
  "lng"              DOUBLE PRECISION,
  "answers"          JSONB                   NOT NULL DEFAULT '[]',
  "photoUrls"        TEXT[]                  DEFAULT ARRAY[]::TEXT[],
  "signatureUrl"     TEXT,
  "status"           "FastFieldReportStatus" NOT NULL DEFAULT 'UNMATCHED',
  "note"             TEXT,
  "siteId"           UUID,
  "jobId"            UUID,
  "patrolVisitId"    UUID,
  "formSubmissionId" UUID,
  "jobCreated"       BOOLEAN                 NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)            NOT NULL,
  CONSTRAINT "FastFieldReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FastFieldReport_submissionId_key" ON "FastFieldReport"("submissionId");
CREATE UNIQUE INDEX "FastFieldReport_formSubmissionId_key" ON "FastFieldReport"("formSubmissionId");
CREATE INDEX "FastFieldReport_status_submittedAt_idx" ON "FastFieldReport"("status", "submittedAt");
CREATE INDEX "FastFieldReport_siteId_idx" ON "FastFieldReport"("siteId");
CREATE INDEX "FastFieldReport_jobId_idx" ON "FastFieldReport"("jobId");
CREATE INDEX "FastFieldReport_patrolVisitId_idx" ON "FastFieldReport"("patrolVisitId");
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "FastFieldForm"("formId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_patrolVisitId_fkey"
  FOREIGN KEY ("patrolVisitId") REFERENCES "PatrolVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_formSubmissionId_fkey"
  FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
