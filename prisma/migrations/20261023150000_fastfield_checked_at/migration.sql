-- When the robot last tried to match a waiting FastField report, so re-checks
-- carry on where they left off instead of retrying the same oldest reports.
ALTER TABLE "FastFieldReport" ADD COLUMN "checkedAt" TIMESTAMP(3);
