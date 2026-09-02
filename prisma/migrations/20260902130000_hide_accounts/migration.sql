-- Admin-only "hide" flag: declutter a customer/partner (and its activities)
-- from the browse/log surfaces admins view. Distinct from `active`.
ALTER TABLE "Customer" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Partner"  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Customer_hidden_idx" ON "Customer"("hidden");
CREATE INDEX "Partner_hidden_idx"  ON "Partner"("hidden");
