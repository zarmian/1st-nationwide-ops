-- Site finance + Nexus partner-supplied metadata

CREATE TYPE "RateService" AS ENUM (
  'ALARM_RESPONSE',
  'KEYHOLDING',
  'LOCKUP',
  'UNLOCK',
  'VPI',
  'PATROL',
  'STATIC_GUARDING',
  'DOG_HANDLER',
  'ADHOC',
  'ANNUAL_SUBSCRIPTION',
  'SITE_SETUP'
);

CREATE TYPE "RateUnit" AS ENUM (
  'PER_VISIT',
  'PER_HOUR',
  'PER_MONTH',
  'PER_YEAR',
  'FIXED'
);

ALTER TABLE "Site"
  ADD COLUMN "partnerReference" TEXT,
  ADD COLUMN "partnerSin"       TEXT,
  ADD COLUMN "sapRef"            TEXT,
  ADD COLUMN "opsUnit"           TEXT,
  ADD COLUMN "what3words"        TEXT,
  ADD COLUMN "partnerStatus"     TEXT,
  ADD COLUMN "startDate"         TIMESTAMP(3),
  ADD COLUMN "terminationDate"   TIMESTAMP(3),
  ADD COLUMN "dne"               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hsMarkers"         BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Site_partnerReference_idx" ON "Site"("partnerReference");

CREATE TABLE "SiteRate" (
  "id"        UUID           NOT NULL DEFAULT gen_random_uuid(),
  "siteId"    UUID           NOT NULL,
  "service"   "RateService"  NOT NULL,
  "amount"    DECIMAL(10, 2) NOT NULL,
  "currency"  TEXT           NOT NULL DEFAULT 'GBP',
  "unit"      "RateUnit"     NOT NULL DEFAULT 'PER_VISIT',
  "validFrom" TIMESTAMP(3),
  "validTo"   TIMESTAMP(3),
  "notes"     TEXT,
  "source"    TEXT,
  "createdAt" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "SiteRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteRate_siteId_service_key" ON "SiteRate"("siteId", "service");
CREATE INDEX "SiteRate_siteId_idx" ON "SiteRate"("siteId");
CREATE INDEX "SiteRate_service_idx" ON "SiteRate"("service");

ALTER TABLE "SiteRate"
  ADD CONSTRAINT "SiteRate_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
