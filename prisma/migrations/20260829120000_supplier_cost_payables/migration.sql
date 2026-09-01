-- Payables: due + paid tracking on supplier bills.
ALTER TABLE "SupplierCost" ADD COLUMN "dueOn"  TIMESTAMP(3);
ALTER TABLE "SupplierCost" ADD COLUMN "paidOn" TIMESTAMP(3);
CREATE INDEX "SupplierCost_paidOn_idx" ON "SupplierCost"("paidOn");
