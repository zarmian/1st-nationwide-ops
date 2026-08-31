-- Subcontracted patrol cost on PatrolVisit — what the partner charges us and
-- pays their officer, mirroring Job / Shift.

ALTER TABLE "PatrolVisit"
  ADD COLUMN "partnerChargeToUsAmount" DECIMAL(10,2),
  ADD COLUMN "partnerOfficerPayAmount" DECIMAL(10,2);
