-- Manual pay adjustments for officer payslips (bonus / expense / deduction …).

CREATE TABLE "PayAdjustment" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "officerId"       UUID          NOT NULL,
  "date"            TIMESTAMP(3)  NOT NULL,
  "kind"            TEXT          NOT NULL,
  "label"           TEXT          NOT NULL,
  "amount"          DECIMAL(12,2) NOT NULL,
  "note"            TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayAdjustment_officerId_date_idx" ON "PayAdjustment"("officerId", "date");
ALTER TABLE "PayAdjustment" ADD CONSTRAINT "PayAdjustment_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
