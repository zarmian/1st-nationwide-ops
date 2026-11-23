-- Rota for the mobile patrols: North Mobile (one 24-hour shift a day,
-- 09:00-09:00 UK) and South Mobile (day shift 09:00-18:00, night shift
-- 18:00-09:00 UK). Rota rows now belong to a patrol instead of a region.
-- Older region-based rows keep their region and have no patrol; nothing is
-- deleted.
--
-- South Mobile shifts are paid a set amount per shift, so officer pay rates
-- get a service for each shift and a "per shift" unit.

ALTER TYPE "RotaShift" ADD VALUE IF NOT EXISTS 'FULL_DAY';
ALTER TYPE "RateService" ADD VALUE IF NOT EXISTS 'SOUTH_MOBILE_DAY_SHIFT';
ALTER TYPE "RateService" ADD VALUE IF NOT EXISTS 'SOUTH_MOBILE_NIGHT_SHIFT';
ALTER TYPE "RateUnit" ADD VALUE IF NOT EXISTS 'PER_SHIFT';

CREATE TYPE "RotaPatrol" AS ENUM ('NORTH_MOBILE', 'SOUTH_MOBILE');

ALTER TABLE "RotaAssignment" ADD COLUMN "patrol" "RotaPatrol";
ALTER TABLE "RotaAssignment" ALTER COLUMN "regionId" DROP NOT NULL;

DROP INDEX IF EXISTS "RotaAssignment_date_shift_regionId_officerId_key";
DROP INDEX IF EXISTS "RotaAssignment_regionId_date_shift_idx";

CREATE UNIQUE INDEX "RotaAssignment_date_shift_patrol_officerId_key"
  ON "RotaAssignment" ("date", "shift", "patrol", "officerId");
