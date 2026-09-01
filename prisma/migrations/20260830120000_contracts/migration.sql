-- Customer service agreements (contracts) + renewal tracking.

CREATE TYPE "ContractCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

CREATE TABLE "Contract" (
  "id"              UUID              NOT NULL DEFAULT gen_random_uuid(),
  "customerId"      UUID              NOT NULL,
  "title"           TEXT              NOT NULL,
  "value"           DECIMAL(12,2)     NOT NULL,
  "cadence"         "ContractCadence" NOT NULL DEFAULT 'MONTHLY',
  "startDate"       TIMESTAMP(3)      NOT NULL,
  "endDate"         TIMESTAMP(3),
  "noticeDays"      INTEGER,
  "status"          "ContractStatus"  NOT NULL DEFAULT 'ACTIVE',
  "notes"           TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Contract_customerId_idx" ON "Contract"("customerId");
CREATE INDEX "Contract_status_endDate_idx" ON "Contract"("status", "endDate");
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
