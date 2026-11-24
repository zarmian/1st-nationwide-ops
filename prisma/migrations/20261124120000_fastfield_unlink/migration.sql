-- FastField reports can be taken off a shift by hand (Unlink). The time it
-- happened is kept, and the robot never links such a report again: it waits
-- for a person to link it or set it aside.
ALTER TABLE "FastFieldReport" ADD COLUMN "unlinkedAt" TIMESTAMP(3);
