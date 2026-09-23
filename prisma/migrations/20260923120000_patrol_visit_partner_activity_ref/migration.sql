-- Imported partner-portal patrols (e.g. Keyholding job numbers) link to the
-- patrol visit our schedule generated instead of becoming a separate job, so
-- re-runs find the same visit. Nullable + UNIQUE (Postgres treats NULLs as
-- distinct, so every other visit keeps NULL).
ALTER TABLE "PatrolVisit" ADD COLUMN "partnerActivityRef" TEXT;
CREATE UNIQUE INDEX "PatrolVisit_partnerActivityRef_key" ON "PatrolVisit"("partnerActivityRef");
