-- Advanced per-schedule controls for VPI / patrol cadence.
--
-- intervalWeeks   INTEGER    When set, overrides the frequency enum:
--                            "every N weeks" anchored on startsOn/createdAt.
--                            1 = weekly, 2 = fortnightly, 3 = every 3 weeks,
--                            etc. NULL = use the existing enum.
-- exceptionDates  TEXT[]     Per-schedule skips. Each "YYYY-MM-DD" entry
--                            tells the materialiser to skip that calendar day
--                            even if the recurrence rule says it's due.
--                            Default [].
--
-- Both columns are additive. Existing rows keep working as today.

ALTER TABLE "PatrolSchedule"
  ADD COLUMN "intervalWeeks"  INTEGER,
  ADD COLUMN "exceptionDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
