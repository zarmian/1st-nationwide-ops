-- Customer invoicing + VAT.

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID');

CREATE TABLE "Invoice" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "number"          TEXT          NOT NULL,
  "customerId"      UUID          NOT NULL,
  "status"          "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "periodFrom"      TIMESTAMP(3)  NOT NULL,
  "periodTo"        TIMESTAMP(3)  NOT NULL,
  "issuedAt"        TIMESTAMP(3),
  "dueAt"           TIMESTAMP(3),
  "subtotal"        DECIMAL(12,2) NOT NULL,
  "vatRate"         DECIMAL(5,4)  NOT NULL,
  "vatAmount"       DECIMAL(12,2) NOT NULL,
  "total"           DECIMAL(12,2) NOT NULL,
  "currency"        TEXT          NOT NULL DEFAULT 'GBP',
  "notes"           TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_customerId_status_idx" ON "Invoice"("customerId", "status");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InvoiceLine" (
  "id"          UUID          NOT NULL DEFAULT gen_random_uuid(),
  "invoiceId"   UUID          NOT NULL,
  "description" TEXT          NOT NULL,
  "service"     TEXT,
  "quantity"    INTEGER       NOT NULL DEFAULT 1,
  "unitAmount"  DECIMAL(12,2) NOT NULL,
  "amount"      DECIMAL(12,2) NOT NULL,
  "sortOrder"   INTEGER       NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Job" ADD COLUMN "invoiceId" UUID;
CREATE INDEX "Job_invoiceId_idx" ON "Job"("invoiceId");
ALTER TABLE "Job" ADD CONSTRAINT "Job_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PatrolVisit" ADD COLUMN "invoiceId" UUID;
CREATE INDEX "PatrolVisit_invoiceId_idx" ON "PatrolVisit"("invoiceId");
ALTER TABLE "PatrolVisit" ADD CONSTRAINT "PatrolVisit_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Shift" ADD COLUMN "invoiceId" UUID;
CREATE INDEX "Shift_invoiceId_idx" ON "Shift"("invoiceId");
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
