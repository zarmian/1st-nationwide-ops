-- Places skipped on FastField (Admin → FastField → Skip): waiting reports
-- whose site, as typed, matches are set aside, and new ones as they arrive.
-- AlterTable
ALTER TABLE "FastFieldReport" ADD COLUMN     "skipId" UUID;

-- CreateTable
CREATE TABLE "FastFieldSkip" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FastFieldSkip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FastFieldSkip_siteKey_key" ON "FastFieldSkip"("siteKey");

-- CreateIndex
CREATE INDEX "FastFieldReport_skipId_idx" ON "FastFieldReport"("skipId");

-- AddForeignKey
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_skipId_fkey" FOREIGN KEY ("skipId") REFERENCES "FastFieldSkip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

