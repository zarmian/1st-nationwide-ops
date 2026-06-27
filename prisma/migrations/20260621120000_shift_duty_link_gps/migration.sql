-- Static-guard / dog-handler duty link + GPS + late-end + audit basis.
--
-- 1. Site.geofenceRadiusM — per-site geofence override (null → 300 m default).
-- 2. Shift gains:
--      publicToken          token-gated /duty/<token> officer link (unique)
--      officerNameRaw       self-entered name when not pre-assigned
--      linkPhone            E.164 number we text the link to
--      start* / end* GPS    lat/lng/accuracy + distance + within-geofence flag
--      endedLate/lateReason late finish requires a reason
--      payableMinutes       worked minutes rounded up to 30, basis for pay
-- 3. NotificationKind gains SHIFT_LINK (the "here is your shift link" SMS).
--
-- ActivityLog already exists (used for the post-completion edit history);
-- no schema change needed there.

ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "geofenceRadiusM" INTEGER;

ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "officerNameRaw" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "linkPhone" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "startLat" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "startLng" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "startGpsAccuracy" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "startDistanceM" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "startWithinGeofence" BOOLEAN;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "endLat" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "endLng" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "endGpsAccuracy" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "endDistanceM" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "endWithinGeofence" BOOLEAN;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "endedLate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lateReason" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "payableMinutes" INTEGER;

-- Unique token index (mirrors @unique on Shift.publicToken).
CREATE UNIQUE INDEX IF NOT EXISTS "Shift_publicToken_key" ON "Shift"("publicToken");

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SHIFT_LINK';
