-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so it
-- lives in its own migration. Postgres 12+ allows this when not in a tx.

ALTER TYPE "JobType" ADD VALUE 'SURVEY';
ALTER TYPE "JobSource" ADD VALUE 'ONBOARDING';
