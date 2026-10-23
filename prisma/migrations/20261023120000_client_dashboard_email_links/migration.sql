-- Client dashboard: clients sign in with a one-time emailed link instead of a
-- password. Additive only.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "portalEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ClientLoginLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tokenHash" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLoginLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientLoginLink_tokenHash_key" ON "ClientLoginLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientLoginLink_email_createdAt_idx" ON "ClientLoginLink"("email", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientLoginLink" ADD CONSTRAINT "ClientLoginLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shurgard staff sign in with their work email (owner's choice, 23 Oct 2026).
-- Change or clear it under Admin → Customers → Shurgard.
UPDATE "Customer" SET "portalEmailDomains" = ARRAY['shurgard.co.uk', 'shurgard.com'] WHERE "name" = 'Shurgard';
