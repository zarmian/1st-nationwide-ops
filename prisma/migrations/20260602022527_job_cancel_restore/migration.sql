-- Cancel/restore snapshot column.
--
-- statusBeforeCancel  JobStatus?  Captured when cancelJob runs; consumed
--                                 by restoreJob to put the job back where
--                                 it was rather than guessing. Null on
--                                 every existing row — cancelJob and
--                                 restoreJob both gate on the column
--                                 being set so the rollout is safe.

ALTER TABLE "Job"
  ADD COLUMN "statusBeforeCancel" "JobStatus";
