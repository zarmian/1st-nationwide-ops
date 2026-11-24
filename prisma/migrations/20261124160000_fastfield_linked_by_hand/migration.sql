-- A FastField report linked by a person can go on any shift; the robot's
-- shift check leaves it where it was put. Reports already linked by hand are
-- the ones whose note the office's Link button wrote ("Linked by …").
ALTER TABLE "FastFieldReport" ADD COLUMN "linkedByHand" BOOLEAN NOT NULL DEFAULT false;

UPDATE "FastFieldReport"
SET "linkedByHand" = true
WHERE "status" = 'LINKED' AND "note" LIKE 'Linked by %';
