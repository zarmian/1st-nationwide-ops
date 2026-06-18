-- Partner portal — Phase 3 schema.
--
-- Adds:
--   - UserRole.PARTNER_OFFICER  New role value for partner-officer
--                               logins (the people on a partner's
--                               roster who can mark their own
--                               activities done on their phone).
--   - PartnerOfficer.userId     Optional 1:1 link to a User row. Set
--                               when the partner-admin issues this
--                               officer a login. SetNull on delete so
--                               revoking the User doesn't wipe roster
--                               history; the PartnerOfficer row stays
--                               around and the link gets cleared.
--
-- Reversible: drop the column and the unique. The enum value can only
-- be removed by recreating the type. No existing rows change.

-- 1. New role value.
ALTER TYPE "UserRole" ADD VALUE 'PARTNER_OFFICER';

-- 2. PartnerOfficer.userId — unique 1:1 FK to User.
ALTER TABLE "PartnerOfficer" ADD COLUMN "userId" UUID;
ALTER TABLE "PartnerOfficer"
  ADD CONSTRAINT "PartnerOfficer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX "PartnerOfficer_userId_key"
  ON "PartnerOfficer"("userId");
