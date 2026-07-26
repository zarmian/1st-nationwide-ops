-- Customer-level default rate card. Site rates override these per service.

CREATE TABLE "CustomerRate" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
  "customerId"       UUID           NOT NULL,
  "service"          "RateService"  NOT NULL,
  "amount"           DECIMAL(10, 2) NOT NULL,
  "currency"         TEXT           NOT NULL DEFAULT 'GBP',
  "unit"             "RateUnit"     NOT NULL DEFAULT 'PER_VISIT',
  "includedMinutes"  INTEGER,
  "excessRatePerMin" DECIMAL(10, 4),
  "validFrom"        TIMESTAMP(3),
  "validTo"          TIMESTAMP(3),
  "notes"            TEXT,
  "source"           TEXT,
  "createdAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "CustomerRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerRate_customerId_service_key" ON "CustomerRate"("customerId", "service");
CREATE INDEX "CustomerRate_customerId_idx" ON "CustomerRate"("customerId");
CREATE INDEX "CustomerRate_service_idx" ON "CustomerRate"("service");

ALTER TABLE "CustomerRate"
  ADD CONSTRAINT "CustomerRate_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
