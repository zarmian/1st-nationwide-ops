-- Last time dispatch was reminded to chase the handling partner (e.g. Nexus)
-- for an update on a handed-off job. Drives the 15-min chase cadence in the
-- shift-checks cron.

ALTER TABLE "Job"
  ADD COLUMN "lastPartnerChaseAt" TIMESTAMP(3);
