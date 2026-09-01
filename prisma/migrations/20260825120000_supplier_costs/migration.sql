-- Supplier costs / bills, carrying input VAT for the VAT return and true P&L.

CREATE TABLE "SupplierCost" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "date"            TIMESTAMP(3)  NOT NULL,
  "supplier"        TEXT          NOT NULL,
  "category"        TEXT          NOT NULL,
  "description"     TEXT,
  "net"             DECIMAL(12,2) NOT NULL,
  "vatRate"         DECIMAL(5,4)  NOT NULL,
  "vatAmount"       DECIMAL(12,2) NOT NULL,
  "gross"           DECIMAL(12,2) NOT NULL,
  "reference"       TEXT,
  "reclaimable"     BOOLEAN       NOT NULL DEFAULT true,
  "notes"           TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "SupplierCost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierCost_date_idx" ON "SupplierCost"("date");
CREATE INDEX "SupplierCost_category_idx" ON "SupplierCost"("category");
