-- Patrols can be subcontracted to a partner (like jobs/shifts already can).
--
-- PatrolSchedule / PatrolVisit gain a partner handler + a "partner records in
-- their own app" flag (mirrors Job.reportedViaPartnerApp).

ALTER TABLE "PatrolSchedule"
  ADD COLUMN IF NOT EXISTS "handledByPartnerId" UUID,
  ADD COLUMN IF NOT EXISTS "partnerFillsOwnApp" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PatrolVisit"
  ADD COLUMN IF NOT EXISTS "handledByPartnerId" UUID,
  ADD COLUMN IF NOT EXISTS "reportedViaPartnerApp" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PatrolSchedule"
  ADD CONSTRAINT "PatrolSchedule_handledByPartnerId_fkey"
  FOREIGN KEY ("handledByPartnerId") REFERENCES "Partner"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PatrolVisit"
  ADD CONSTRAINT "PatrolVisit_handledByPartnerId_fkey"
  FOREIGN KEY ("handledByPartnerId") REFERENCES "Partner"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "PatrolSchedule_handledByPartnerId_idx" ON "PatrolSchedule"("handledByPartnerId");
CREATE INDEX IF NOT EXISTS "PatrolVisit_handledByPartnerId_idx" ON "PatrolVisit"("handledByPartnerId");
