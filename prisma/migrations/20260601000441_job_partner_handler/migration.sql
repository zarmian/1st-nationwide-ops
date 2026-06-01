-- Partner-as-subcontractor handover fields on "Job".
--
-- Distinct from Job.partnerId (which mirrors Site.partnerId — the
-- partner-as-customer relationship; "this site belongs to Nexus and
-- they gave us the work"). The new handledByPartnerId captures the
-- reverse: "we received this job and gave it to a partner to attend".
--
-- Both columns are nullable; existing Jobs (all internal-officer
-- attended) keep NULL and behave as before.

ALTER TABLE "Job"
  ADD COLUMN "handledByPartnerId" UUID,
  ADD COLUMN "handedOffAt"        TIMESTAMP(3);

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_handledByPartnerId_fkey"
    FOREIGN KEY ("handledByPartnerId") REFERENCES "Partner"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Job_handledByPartnerId_idx" ON "Job"("handledByPartnerId");
