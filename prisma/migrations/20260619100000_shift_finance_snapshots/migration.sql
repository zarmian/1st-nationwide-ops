-- Shift finance snapshots — Job/PatrolVisit-parity columns so /finance
-- can aggregate shifts alongside the other two activity tables.
--
-- billedAmount       What we billed our customer for this shift
--                    (from SiteRate, snapshotted on completion).
-- billedCurrency     Currency at the time of snapshot (defaults GBP).
-- billedAt           When we wrote the billed amount.
-- paidAmount         What we paid OUR internal officer (from
--                    OfficerRate) — only set for officer-handled
--                    shifts. Partner-handled shifts leave this null;
--                    Shift.partnerChargeToUsAmount already captures
--                    the cost we owe the partner.
-- paidCurrency       As above.
-- paidAt             When we wrote the pay amount.
-- payRateUnit        PER_HOUR / PER_VISIT / etc. — same vocabulary
--                    as PatrolVisit.payRateUnit. Display only.
--
-- All nullable — existing rows are unaffected. Finance aggregations
-- need to COALESCE these to 0 when summing.

ALTER TABLE "Shift"
  ADD COLUMN "billedAmount"   DECIMAL(10, 2),
  ADD COLUMN "billedCurrency" TEXT,
  ADD COLUMN "billedAt"       TIMESTAMP(3),
  ADD COLUMN "paidAmount"     DECIMAL(10, 2),
  ADD COLUMN "paidCurrency"   TEXT,
  ADD COLUMN "paidAt"         TIMESTAMP(3),
  ADD COLUMN "payRateUnit"    TEXT;
