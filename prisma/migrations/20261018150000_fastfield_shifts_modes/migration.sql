-- FastField import, round 2. Forms are shared between clients (the Site
-- Patrol and Alarm Response forms are used for Shurgard and others; static
-- shifts at Shurgard sites use the Site Patrol form), so:
--   * a form gets a mode — Off / Preview only / On — instead of on/off;
--   * "create the job when nothing matches" names the client it applies to
--     (createCustomerId) instead of a yes/no;
--   * a report can be attached to a static / dog-handler shift;
--   * the last preview's counts are kept per form for Admin → FastField.

CREATE TYPE "FastFieldFormMode" AS ENUM ('OFF', 'PREVIEW', 'ON');

ALTER TABLE "FastFieldForm"
  ADD COLUMN "mode"             "FastFieldFormMode" NOT NULL DEFAULT 'OFF',
  ADD COLUMN "createCustomerId" UUID,
  ADD COLUMN "previewCounts"    JSONB,
  ADD COLUMN "previewAt"        TIMESTAMP(3),
  ADD COLUMN "previewRun"       TEXT;

UPDATE "FastFieldForm" SET "mode" = 'ON' WHERE "enabled";
UPDATE "FastFieldForm" SET "createCustomerId" = "customerId"
  WHERE "createJobs" AND "customerId" IS NOT NULL;

-- Form 549243 is the Site Patrol form, not a Shurgard-only form: undo the
-- Shurgard preset the first version gave it.
UPDATE "FastFieldForm" SET "customerId" = NULL, "createCustomerId" = NULL
  WHERE "formId" = 549243 AND "name" NOT ILIKE '%shurgard%';

-- Starting settings for the forms the office named, set to Preview only so a
-- preview run shows what would happen before anything is imported.
--   Shurgard-titled form → Shurgard sites only; creates the callout.
--   Site Patrol form     → any client; static shifts / patrols; never creates.
--   Alarm Response form  → any client; creates the callout at Shurgard sites.
UPDATE "FastFieldForm" SET
    "customerId"       = (SELECT "id" FROM "Customer" WHERE "name" ILIKE '%shurgard%' ORDER BY length("name"), "name" LIMIT 1),
    "createCustomerId" = (SELECT "id" FROM "Customer" WHERE "name" ILIKE '%shurgard%' ORDER BY length("name"), "name" LIMIT 1),
    "jobType"          = 'ALARM_RESPONSE',
    "mode"             = CASE WHEN "mode" = 'OFF' THEN 'PREVIEW'::"FastFieldFormMode" ELSE "mode" END
  WHERE "name" ILIKE '%shurgard%';

UPDATE "FastFieldForm" SET
    "customerId"       = NULL,
    "createCustomerId" = NULL,
    "jobType"          = 'PATROL',
    "mode"             = CASE WHEN "mode" = 'OFF' THEN 'PREVIEW'::"FastFieldFormMode" ELSE "mode" END
  WHERE "name" ILIKE '%site patrol%' AND "name" NOT ILIKE '%shurgard%';

UPDATE "FastFieldForm" SET
    "customerId"       = NULL,
    "createCustomerId" = (SELECT "id" FROM "Customer" WHERE "name" ILIKE '%shurgard%' ORDER BY length("name"), "name" LIMIT 1),
    "jobType"          = 'ALARM_RESPONSE',
    "mode"             = CASE WHEN "mode" = 'OFF' THEN 'PREVIEW'::"FastFieldFormMode" ELSE "mode" END
  WHERE "name" ILIKE '%alarm response%' AND "name" NOT ILIKE '%shurgard%';

ALTER TABLE "FastFieldForm" DROP COLUMN "enabled", DROP COLUMN "createJobs";
ALTER TABLE "FastFieldForm" ADD CONSTRAINT "FastFieldForm_createCustomerId_fkey"
  FOREIGN KEY ("createCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FastFieldReport" ADD COLUMN "shiftId" UUID;
CREATE INDEX "FastFieldReport_shiftId_idx" ON "FastFieldReport"("shiftId");
ALTER TABLE "FastFieldReport" ADD CONSTRAINT "FastFieldReport_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
