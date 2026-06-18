-- Partner portal — Phase 2 schema.
--
-- Adds the data shape for partner-recorded activities:
--   - PartnerRate                Rate card per (partner, service) with
--                                chargeToUs + payToOfficer. Auto-fills
--                                the form when partners record an
--                                activity; they can override per row.
--   - Job columns                handledByPartnerOfficerId (which of
--                                THEIR officers did it), the two rate
--                                snapshots, recordedByPartner marker
--                                so we can tell partner-recorded rows
--                                from ones we sent them.
--   - Shift columns              Same trio + handledByPartnerId (Shift
--                                didn't have a partner FK at all yet),
--                                plus a recordedByPartner marker.
--
-- All new columns are nullable / defaulted, so backfilling existing
-- rows is a no-op. Existing /dispatch + /finance behaviour is
-- unchanged for rows that lack these fields.

-- 1. PartnerRate
CREATE TABLE "PartnerRate" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "partnerId"    UUID         NOT NULL,
  "service"      "RateService" NOT NULL,
  "chargeToUs"   DECIMAL(10,2) NOT NULL,
  "payToOfficer" DECIMAL(10,2) NOT NULL,
  "currency"     TEXT          NOT NULL DEFAULT 'GBP',
  "unit"         "RateUnit"    NOT NULL DEFAULT 'PER_VISIT',
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "PartnerRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerRate_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PartnerRate_partnerId_service_key"
  ON "PartnerRate"("partnerId", "service");
CREATE INDEX "PartnerRate_partnerId_idx" ON "PartnerRate"("partnerId");

-- 2. Job columns
ALTER TABLE "Job"
  ADD COLUMN "handledByPartnerOfficerId" UUID,
  ADD COLUMN "partnerChargeToUsAmount"   DECIMAL(10,2),
  ADD COLUMN "partnerOfficerPayAmount"   DECIMAL(10,2),
  ADD COLUMN "recordedByPartner"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job"
  ADD CONSTRAINT "Job_handledByPartnerOfficerId_fkey"
  FOREIGN KEY ("handledByPartnerOfficerId") REFERENCES "PartnerOfficer"(id)
  ON DELETE SET NULL;

-- 3. Shift columns + FKs + index
ALTER TABLE "Shift"
  ADD COLUMN "handledByPartnerId"          UUID,
  ADD COLUMN "handledByPartnerOfficerId"   UUID,
  ADD COLUMN "partnerChargeToUsAmount"     DECIMAL(10,2),
  ADD COLUMN "partnerOfficerPayAmount"     DECIMAL(10,2),
  ADD COLUMN "recordedByPartner"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_handledByPartnerId_fkey"
  FOREIGN KEY ("handledByPartnerId") REFERENCES "Partner"(id)
  ON DELETE SET NULL;
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_handledByPartnerOfficerId_fkey"
  FOREIGN KEY ("handledByPartnerOfficerId") REFERENCES "PartnerOfficer"(id)
  ON DELETE SET NULL;
CREATE INDEX "Shift_handledByPartnerId_idx" ON "Shift"("handledByPartnerId");
