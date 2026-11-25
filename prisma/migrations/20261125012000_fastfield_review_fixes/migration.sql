-- FastField review fixes: when a report was linked, who took it off its
-- activity (the robot or a person), the rules version it was last judged
-- under, and a run lock so only one copy of a background run works at a time.

-- CreateEnum
CREATE TYPE "FastFieldUnlinkBy" AS ENUM ('ROBOT', 'PERSON');

-- AlterTable
ALTER TABLE "FastFieldReport" ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "rulesVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unlinkedBy" "FastFieldUnlinkBy";

-- CreateTable
CREATE TABLE "RunLock" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "holder" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunLock_pkey" PRIMARY KEY ("name")
);

-- Backfill: when each attached report was linked. Its approved review is
-- created at that moment (a robot move keeps the same review).
UPDATE "FastFieldReport" r
SET "linkedAt" = rr."reviewedAt"
FROM "ReportReview" rr
WHERE rr."submissionId" = r."formSubmissionId"
  AND r."status" IN ('LINKED', 'CREATED')
  AND rr."reviewedAt" IS NOT NULL;

-- Backfill: who took each report off its shift. A person, unless the robot's
-- own shift-history line (or the robot's note) says the robot did it.
UPDATE "FastFieldReport" SET "unlinkedBy" = 'PERSON' WHERE "unlinkedAt" IS NOT NULL;

WITH last_unlink AS (
  SELECT DISTINCT ON (a."diff"->>'fastfieldReportId')
         a."diff"->>'fastfieldReportId' AS report_id,
         a."diff"->>'by' AS by
  FROM "ActivityLog" a
  WHERE a."entity" = 'Shift' AND a."action" = 'fastfield_unlinked'
  ORDER BY a."diff"->>'fastfieldReportId', a."createdAt" DESC
)
UPDATE "FastFieldReport" r
SET "unlinkedBy" = 'ROBOT'
FROM last_unlink l
WHERE l.report_id = r."id"::text AND l.by = 'robot' AND r."unlinkedAt" IS NOT NULL;

UPDATE "FastFieldReport" SET "unlinkedBy" = 'ROBOT'
WHERE "unlinkedAt" IS NOT NULL AND "note" LIKE '%by the robot:%';
