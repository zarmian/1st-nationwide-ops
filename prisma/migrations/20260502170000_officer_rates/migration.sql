-- Officer pay rates and per-activity paid snapshot fields.
-- OfficerRate.officerId is nullable: a row with officerId NULL is a
-- company-wide default for that service. Per-officer rows override.

CREATE TABLE "OfficerRate" (
  "id"        UUID           NOT NULL DEFAULT gen_random_uuid(),
  "officerId" UUID,
  "service"   "RateService"  NOT NULL,
  "amount"    DECIMAL(10, 2) NOT NULL,
  "currency"  TEXT           NOT NULL DEFAULT 'GBP',
  "unit"      "RateUnit"     NOT NULL DEFAULT 'PER_VISIT',
  "validFrom" TIMESTAMP(3),
  "validTo"   TIMESTAMP(3),
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "OfficerRate_pkey" PRIMARY KEY ("id")
);

-- Multiple NULL officerIds with the same service shouldn't happen, but
-- Postgres unique constraints treat NULLs as distinct so we add a partial
-- unique index for the company-default rows on top of the standard one.
CREATE UNIQUE INDEX "OfficerRate_officerId_service_key" ON "OfficerRate"("officerId", "service");
CREATE UNIQUE INDEX "OfficerRate_company_default_unique"
  ON "OfficerRate"("service")
  WHERE "officerId" IS NULL;
CREATE INDEX "OfficerRate_officerId_idx" ON "OfficerRate"("officerId");
CREATE INDEX "OfficerRate_service_idx" ON "OfficerRate"("service");

ALTER TABLE "OfficerRate"
  ADD CONSTRAINT "OfficerRate_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Paid snapshot fields on activities (mirror of the billed-snapshot fields)
ALTER TABLE "PatrolVisit"
  ADD COLUMN "paidAmount"   DECIMAL(10, 2),
  ADD COLUMN "paidCurrency" TEXT,
  ADD COLUMN "paidAt"       TIMESTAMP(3);

ALTER TABLE "Job"
  ADD COLUMN "paidCurrency" TEXT,
  ADD COLUMN "paidAt"       TIMESTAMP(3);
