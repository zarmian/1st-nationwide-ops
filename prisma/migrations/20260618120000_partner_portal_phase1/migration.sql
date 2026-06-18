-- Partner portal — Phase 1 schema.
--
-- Adds:
--   - UserRole.PARTNER       New role value for partner-portal seats.
--   - User.partnerId         FK linking a User to a Partner row. Set
--                            only when role = PARTNER. SetNull on delete
--                            so removing a partner doesn't cascade and
--                            wipe their login row (we'd want to inspect
--                            it manually).
--   - PartnerOfficer         Partner's private officer roster — not in
--                            the User table; doesn't appear in any of
--                            our staff lists. Cascade-deletes if the
--                            partner is removed.
--
-- Reversible: drop the table, drop the column, but the enum value can
-- only be removed by recreating the type. Existing rows don't change.

-- 1. New role value.
ALTER TYPE "UserRole" ADD VALUE 'PARTNER';

-- 2. User.partnerId column + FK + index.
ALTER TABLE "User" ADD COLUMN "partnerId" UUID;
ALTER TABLE "User"
  ADD CONSTRAINT "User_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "Partner"(id) ON DELETE SET NULL;
CREATE INDEX "User_partnerId_idx" ON "User"("partnerId");

-- 3. PartnerOfficer table.
CREATE TABLE "PartnerOfficer" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "partnerId" UUID         NOT NULL,
  "name"      TEXT         NOT NULL,
  "phone"     TEXT,
  "siaNumber" TEXT,
  "notes"     TEXT,
  "active"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerOfficer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerOfficer_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"(id) ON DELETE CASCADE
);
CREATE INDEX "PartnerOfficer_partnerId_active_idx"
  ON "PartnerOfficer"("partnerId", "active");
