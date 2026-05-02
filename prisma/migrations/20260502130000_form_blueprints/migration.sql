-- Prebuilt form blueprints — pickable starters for new templates
CREATE TABLE "FormBlueprint" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "jobType"     "SubmissionForm",
  "fields"      JSONB NOT NULL DEFAULT '[]',
  "source"      TEXT,
  "builtin"     BOOLEAN NOT NULL DEFAULT false,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "createdById" UUID,

  CONSTRAINT "FormBlueprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormBlueprint_slug_key" ON "FormBlueprint"("slug");
CREATE INDEX "FormBlueprint_active_idx" ON "FormBlueprint"("active");
CREATE INDEX "FormBlueprint_builtin_idx" ON "FormBlueprint"("builtin");

ALTER TABLE "FormBlueprint"
  ADD CONSTRAINT "FormBlueprint_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Track which blueprint a template was instantiated from (nullable, optional).
ALTER TABLE "FormTemplate" ADD COLUMN "blueprintId" UUID;
CREATE INDEX "FormTemplate_blueprintId_idx" ON "FormTemplate"("blueprintId");

ALTER TABLE "FormTemplate"
  ADD CONSTRAINT "FormTemplate_blueprintId_fkey"
  FOREIGN KEY ("blueprintId") REFERENCES "FormBlueprint"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
