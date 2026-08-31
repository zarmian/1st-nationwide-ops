-- Recurring / subscription billing (retainers, subscriptions, setup fees).

CREATE TYPE "RecurringCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF');

CREATE TABLE "RecurringCharge" (
  "id"          UUID             NOT NULL DEFAULT gen_random_uuid(),
  "customerId"  UUID             NOT NULL,
  "description" TEXT             NOT NULL,
  "service"     TEXT,
  "amount"      DECIMAL(10,2)    NOT NULL,
  "currency"    TEXT             NOT NULL DEFAULT 'GBP',
  "cadence"     "RecurringCadence" NOT NULL DEFAULT 'MONTHLY',
  "startDate"   TIMESTAMP(3)     NOT NULL,
  "endDate"     TIMESTAMP(3),
  "active"      BOOLEAN          NOT NULL DEFAULT true,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "RecurringCharge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecurringCharge_customerId_active_idx" ON "RecurringCharge"("customerId", "active");
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecurringChargeRun" (
  "id"                UUID          NOT NULL DEFAULT gen_random_uuid(),
  "recurringChargeId" UUID          NOT NULL,
  "periodKey"         TEXT          NOT NULL,
  "amount"            DECIMAL(10,2) NOT NULL,
  "invoiceId"         UUID,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringChargeRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecurringChargeRun_recurringChargeId_periodKey_key"
  ON "RecurringChargeRun"("recurringChargeId", "periodKey");
CREATE INDEX "RecurringChargeRun_invoiceId_idx" ON "RecurringChargeRun"("invoiceId");
ALTER TABLE "RecurringChargeRun" ADD CONSTRAINT "RecurringChargeRun_recurringChargeId_fkey"
  FOREIGN KEY ("recurringChargeId") REFERENCES "RecurringCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringChargeRun" ADD CONSTRAINT "RecurringChargeRun_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
