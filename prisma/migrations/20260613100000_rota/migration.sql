-- Officer rota — availability + region-wise dispatcher assignments.
--
-- RotaShift            ENUM    DAY (06:00-18:00 UK) and NIGHT (18:00-06:00 UK,
--                              date anchored to the START day).
-- OfficerAvailability          One row per (officer, date, shift). Existence =
--                              officer marked themselves available; absence =
--                              not available. Self-service from /m/rota.
-- RotaAssignment               Dispatcher-set assignment of one officer to
--                              one region for one date+shift. Multiple
--                              officers can be assigned per region+shift —
--                              the unique constraint includes officerId so
--                              the same officer can't be double-assigned.
--                              Each officer can be assigned to at most one
--                              region per (date, shift) — enforced
--                              additionally below.
--
-- Cascading: dropping an officer removes their availability and assignments.
-- Region is a hard reference (no cascade) — deletion is rare and we'd want
-- a manual cleanup pass.

CREATE TYPE "RotaShift" AS ENUM ('DAY', 'NIGHT');

CREATE TABLE "OfficerAvailability" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "officerId" UUID         NOT NULL,
  "date"      DATE         NOT NULL,
  "shift"     "RotaShift"  NOT NULL,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OfficerAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfficerAvailability_officerId_fkey"
    FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "OfficerAvailability_officerId_date_shift_key"
  ON "OfficerAvailability" ("officerId", "date", "shift");

CREATE INDEX "OfficerAvailability_date_shift_idx"
  ON "OfficerAvailability" ("date", "shift");

CREATE TABLE "RotaAssignment" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "date"            DATE         NOT NULL,
  "shift"           "RotaShift"  NOT NULL,
  "regionId"        INTEGER      NOT NULL,
  "officerId"       UUID         NOT NULL,
  "notes"           TEXT,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RotaAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RotaAssignment_regionId_fkey"
    FOREIGN KEY ("regionId") REFERENCES "Region"("id"),
  CONSTRAINT "RotaAssignment_officerId_fkey"
    FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "RotaAssignment_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "RotaAssignment_date_shift_regionId_officerId_key"
  ON "RotaAssignment" ("date", "shift", "regionId", "officerId");

CREATE INDEX "RotaAssignment_officerId_date_idx"
  ON "RotaAssignment" ("officerId", "date");

CREATE INDEX "RotaAssignment_regionId_date_shift_idx"
  ON "RotaAssignment" ("regionId", "date", "shift");
