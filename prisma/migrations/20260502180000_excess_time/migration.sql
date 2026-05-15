-- Excess-time surcharge. The base rate covers includedMinutes; anything
-- past that bills/pays at excessRatePerMin (in minutes — 4 dp because
-- rates like £0.1725 / min are realistic).
ALTER TABLE "SiteRate"
  ADD COLUMN "includedMinutes"  INTEGER,
  ADD COLUMN "excessRatePerMin" DECIMAL(10, 4);

ALTER TABLE "OfficerRate"
  ADD COLUMN "includedMinutes"  INTEGER,
  ADD COLUMN "excessRatePerMin" DECIMAL(10, 4);
