-- Collapse OnboardingStage: drop FRONT_KEY / SHUTTER_KEY / ALARM_FOB,
-- add KEY_COLLECTION. Postgres won't drop in-use enum values, so we
-- recreate the type and remap existing rows.

ALTER TYPE "OnboardingStage" RENAME TO "OnboardingStage_old";

CREATE TYPE "OnboardingStage" AS ENUM ('PROPOSED', 'SURVEY', 'KEY_COLLECTION', 'GO_LIVE', 'CANCELLED');

ALTER TABLE "OnboardingPipeline"
  ALTER COLUMN "stage" DROP DEFAULT,
  ALTER COLUMN "stage" TYPE "OnboardingStage"
  USING (
    CASE "stage"::text
      WHEN 'FRONT_KEY' THEN 'KEY_COLLECTION'
      WHEN 'SHUTTER_KEY' THEN 'KEY_COLLECTION'
      WHEN 'ALARM_FOB' THEN 'KEY_COLLECTION'
      ELSE "stage"::text
    END
  )::"OnboardingStage";

ALTER TABLE "OnboardingPipeline" ALTER COLUMN "stage" SET DEFAULT 'PROPOSED'::"OnboardingStage";

DROP TYPE "OnboardingStage_old";

-- New optional fields on the pipeline
ALTER TABLE "OnboardingPipeline" ADD COLUMN "targetGoLiveDate" TIMESTAMP(3);
ALTER TABLE "OnboardingPipeline" ADD COLUMN "cancelReason" TEXT;

-- Link a Job back to its pipeline (for setup jobs created by onboarding)
ALTER TABLE "Job" ADD COLUMN "onboardingPipelineId" UUID;

CREATE INDEX "Job_onboardingPipelineId_idx" ON "Job"("onboardingPipelineId");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_onboardingPipelineId_fkey"
  FOREIGN KEY ("onboardingPipelineId") REFERENCES "OnboardingPipeline"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
