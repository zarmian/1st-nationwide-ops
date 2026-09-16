-- Flag for an imported partner activity that may duplicate a manually-entered
-- job (same site, type and time). Drives a ⚠ review badge; never blocks import.
ALTER TABLE "Job" ADD COLUMN "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false;
