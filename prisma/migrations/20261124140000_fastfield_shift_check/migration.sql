-- The robot checks that each FastField report on a shift fits inside the
-- shift's time, taking off any that don't. shiftCheckedAt records when it
-- last checked a report; it is null for every existing report, so the first
-- pass covers every report ever put on a shift.
ALTER TABLE "FastFieldReport" ADD COLUMN "shiftCheckedAt" TIMESTAMP(3);
