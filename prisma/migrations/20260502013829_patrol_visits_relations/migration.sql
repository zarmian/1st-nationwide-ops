-- Make PatrolVisit.officerId nullable so the cron can create unassigned visits
-- when the schedule has no assignedOfficerId. Drop and re-add the FK.
ALTER TABLE "PatrolVisit" DROP CONSTRAINT "PatrolVisit_officerId_fkey";
ALTER TABLE "PatrolVisit" ALTER COLUMN "officerId" DROP NOT NULL;
ALTER TABLE "PatrolVisit"
  ADD CONSTRAINT "PatrolVisit_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "User"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- FormSubmission gains patrolVisitId so a submission can complete a visit
ALTER TABLE "FormSubmission" ADD COLUMN "patrolVisitId" UUID;

CREATE INDEX "FormSubmission_patrolVisitId_idx" ON "FormSubmission"("patrolVisitId");

ALTER TABLE "FormSubmission"
  ADD CONSTRAINT "FormSubmission_patrolVisitId_fkey"
  FOREIGN KEY ("patrolVisitId") REFERENCES "PatrolVisit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
