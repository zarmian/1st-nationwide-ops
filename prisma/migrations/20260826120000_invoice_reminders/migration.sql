-- Overdue-invoice reminder log (dunning). One row per invoice + stage.

CREATE TABLE "InvoiceReminder" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "invoiceId" UUID         NOT NULL,
  "stage"     TEXT         NOT NULL,
  "sentAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "toEmail"   TEXT         NOT NULL,
  CONSTRAINT "InvoiceReminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvoiceReminder_invoiceId_stage_key" ON "InvoiceReminder"("invoiceId", "stage");
CREATE INDEX "InvoiceReminder_invoiceId_idx" ON "InvoiceReminder"("invoiceId");
ALTER TABLE "InvoiceReminder" ADD CONSTRAINT "InvoiceReminder_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
