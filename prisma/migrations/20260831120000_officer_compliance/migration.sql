-- Officer compliance / vetting: SIA expiry, right-to-work, DBS + training certs.

ALTER TABLE "User" ADD COLUMN "siaExpiry"         TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "rightToWorkExpiry" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "dbsCheckedOn"      TIMESTAMP(3);

CREATE TABLE "OfficerCertification" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "officerId" UUID         NOT NULL,
  "name"      TEXT         NOT NULL,
  "issuedOn"  TIMESTAMP(3),
  "expiresOn" TIMESTAMP(3),
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficerCertification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OfficerCertification_officerId_idx" ON "OfficerCertification"("officerId");
CREATE INDEX "OfficerCertification_expiresOn_idx" ON "OfficerCertification"("expiresOn");
ALTER TABLE "OfficerCertification" ADD CONSTRAINT "OfficerCertification_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
