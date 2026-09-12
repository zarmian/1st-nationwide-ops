-- Audit stamp: who last set up / changed a patrol schedule (via a site's
-- patrol settings). Patrol visits are system-generated from schedules, so this
-- is where "who created the patrol" is recorded.
ALTER TABLE "PatrolSchedule" ADD COLUMN "createdByUserId" UUID;
ALTER TABLE "PatrolSchedule"
  ADD CONSTRAINT "PatrolSchedule_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
