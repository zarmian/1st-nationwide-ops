-- Invoice sending + payment tracking (part-payments, aged debt).

-- Stamp when an invoice was emailed to the customer.
ALTER TABLE "Invoice" ADD COLUMN "emailedAt" TIMESTAMP(3);

-- Payments received against an invoice. Supports part payments; the invoice
-- flips to PAID once the payments cover its total.
CREATE TABLE "InvoicePayment" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "invoiceId"       UUID          NOT NULL,
  "amount"          DECIMAL(12,2) NOT NULL,
  "paidOn"          TIMESTAMP(3)  NOT NULL,
  "method"          TEXT,
  "reference"       TEXT,
  "notes"           TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
