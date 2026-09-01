-- Credit notes — reduce what a customer owes; net off VAT and receivables.

CREATE TYPE "CreditNoteStatus" AS ENUM ('ISSUED', 'VOID');

CREATE TABLE "CreditNote" (
  "id"              UUID              NOT NULL DEFAULT gen_random_uuid(),
  "number"          TEXT              NOT NULL,
  "customerId"      UUID              NOT NULL,
  "invoiceId"       UUID,
  "status"          "CreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
  "issuedAt"        TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason"          TEXT              NOT NULL,
  "subtotal"        DECIMAL(12,2)     NOT NULL,
  "vatRate"         DECIMAL(5,4)      NOT NULL,
  "vatAmount"       DECIMAL(12,2)     NOT NULL,
  "total"           DECIMAL(12,2)     NOT NULL,
  "currency"        TEXT              NOT NULL DEFAULT 'GBP',
  "notes"           TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");
CREATE INDEX "CreditNote_customerId_status_idx" ON "CreditNote"("customerId", "status");
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
