-- Multiple patrol times per day + overnight night-grouping.
--
-- 1. PatrolSchedule.timesOfDay — ordered "HH:MM" list; one visit per time.
-- 2. PatrolVisit.scheduleDate  — the night/day a visit is grouped under
--    (after-midnight patrols keep the date of the evening they started).

ALTER TABLE "PatrolSchedule"
  ADD COLUMN IF NOT EXISTS "timesOfDay" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "PatrolVisit"
  ADD COLUMN IF NOT EXISTS "scheduleDate" TIMESTAMP(3);

-- Backfill: carry the existing single time into the new list so current
-- schedules keep materialising exactly as before.
UPDATE "PatrolSchedule"
  SET "timesOfDay" = ARRAY["timeOfDay"]
  WHERE "timeOfDay" IS NOT NULL
    AND "timeOfDay" <> ''
    AND cardinality("timesOfDay") = 0;
