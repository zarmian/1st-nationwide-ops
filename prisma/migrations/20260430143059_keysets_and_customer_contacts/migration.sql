-- CreateTable
CREATE TABLE "KeySet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "internalNo" TEXT,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeySet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KeySet_internalNo_key" ON "KeySet"("internalNo");

-- CreateIndex
CREATE INDEX "KeySet_siteId_idx" ON "KeySet"("siteId");

-- AddForeignKey
ALTER TABLE "KeySet" ADD CONSTRAINT "KeySet_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Key" ADD COLUMN "keySetId" UUID;
ALTER TABLE "Key" ADD COLUMN "copyOfId" UUID;
ALTER TABLE "Key" ADD COLUMN "duplicable" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Key_keySetId_idx" ON "Key"("keySetId");

-- CreateIndex
CREATE INDEX "Key_copyOfId_idx" ON "Key"("copyOfId");

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_keySetId_fkey" FOREIGN KEY ("keySetId") REFERENCES "KeySet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_copyOfId_fkey" FOREIGN KEY ("copyOfId") REFERENCES "Key"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "ref" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
