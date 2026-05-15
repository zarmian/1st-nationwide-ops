-- Billing-snapshot fields on activities. The amount the customer is charged
-- gets calculated once (from SiteRate) and snapshotted on the activity row,
-- so future rate changes don't retroactively alter historical billing.

ALTER TABLE "PatrolVisit"
  ADD COLUMN "billedAmount"   DECIMAL(10, 2),
  ADD COLUMN "billedCurrency" TEXT,
  ADD COLUMN "billedAt"       TIMESTAMP(3),
  ADD COLUMN "payRateUnit"    TEXT;

ALTER TABLE "Job"
  ADD COLUMN "billedCurrency" TEXT,
  ADD COLUMN "billedAt"       TIMESTAMP(3);
