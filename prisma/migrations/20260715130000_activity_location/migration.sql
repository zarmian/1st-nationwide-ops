-- Officer location captured on activity submission (web geolocation / Telegram).

ALTER TABLE "Job"
  ADD COLUMN "lat"       DOUBLE PRECISION,
  ADD COLUMN "lng"       DOUBLE PRECISION,
  ADD COLUMN "locatedAt" TIMESTAMP(3);

ALTER TABLE "PatrolVisit"
  ADD COLUMN "lat"       DOUBLE PRECISION,
  ADD COLUMN "lng"       DOUBLE PRECISION,
  ADD COLUMN "locatedAt" TIMESTAMP(3);

ALTER TABLE "Shift"
  ADD COLUMN "lat"       DOUBLE PRECISION,
  ADD COLUMN "lng"       DOUBLE PRECISION,
  ADD COLUMN "locatedAt" TIMESTAMP(3);

ALTER TABLE "User"
  ADD COLUMN "pendingLocationJobId" UUID;
