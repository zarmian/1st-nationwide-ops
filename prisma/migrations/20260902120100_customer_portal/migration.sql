-- Client portal: scope a CUSTOMER login to a single customer.
ALTER TABLE "User" ADD COLUMN "customerId" UUID;
CREATE INDEX "User_customerId_idx" ON "User"("customerId");
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
