-- Stable dedup key for jobs imported from a partner portal's activity list
-- (the Nexus "Link" dashboard callouts, e.g. "LINK-2483487"). The nightly
-- reader upserts on this so a re-run updates the same stub instead of
-- creating a duplicate. Nullable + UNIQUE: Postgres treats multiple NULLs as
-- distinct, so every non-portal job can keep partnerActivityRef = NULL.
ALTER TABLE "Job" ADD COLUMN "partnerActivityRef" TEXT;
CREATE UNIQUE INDEX "Job_partnerActivityRef_key" ON "Job"("partnerActivityRef");
