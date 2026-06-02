-- Per-schedule customisation for VPI / patrol cadence.
--
-- timeOfDay  TEXT      "HH:MM" UK wall-clock time. NULL = use the kind
--                      default (09:00 for VPI, 22:00 for patrols).
-- createdAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP. Backfills to
--                      now() for existing rows. Used as the FORTNIGHTLY
--                      parity anchor when startsOn is NULL (matches the
--                      "every other matching day starting from when I
--                      created the schedule" mental model — the old
--                      epoch-based parity could skip the current week
--                      unpredictably).
--
-- Both columns are additive; no existing row needs touching for the
-- app to keep working. Existing visits keep their stored scheduledAt
-- exactly as before — the kind default is only used when materialising
-- a NEW visit and timeOfDay is unset.

ALTER TABLE "PatrolSchedule"
  ADD COLUMN "timeOfDay" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
