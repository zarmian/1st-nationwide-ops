-- Add optional SIA badge number to User
ALTER TABLE "User" ADD COLUMN "siaNumber" TEXT;
CREATE UNIQUE INDEX "User_siaNumber_key" ON "User"("siaNumber");

-- Allow form templates to apply to any job type (NULL = all)
ALTER TABLE "FormTemplate" ALTER COLUMN "jobType" DROP NOT NULL;
