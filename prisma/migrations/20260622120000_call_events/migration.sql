-- Call events from the phone provider (bOnline) webhook + missed-call alert.
--
-- 1. CallEvent — raw payload always kept + best-effort normalised fields for
--    the call log and missed-call → dispatch SMS.
-- 2. NotificationKind gains MISSED_CALL.

CREATE TABLE IF NOT EXISTS "CallEvent" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider"    TEXT NOT NULL DEFAULT 'bonline',
    "externalId"  TEXT,
    "direction"   TEXT,
    "status"      TEXT,
    "rawStatus"   TEXT,
    "fromNumber"  TEXT,
    "toNumber"    TEXT,
    "durationSec" INTEGER,
    "missed"      BOOLEAN NOT NULL DEFAULT false,
    "alerted"     BOOLEAN NOT NULL DEFAULT false,
    "occurredAt"  TIMESTAMP(3),
    "payload"     JSONB NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallEvent_occurredAt_idx" ON "CallEvent"("occurredAt");
CREATE INDEX IF NOT EXISTS "CallEvent_missed_idx" ON "CallEvent"("missed");
CREATE INDEX IF NOT EXISTS "CallEvent_externalId_idx" ON "CallEvent"("externalId");
CREATE INDEX IF NOT EXISTS "CallEvent_createdAt_idx" ON "CallEvent"("createdAt");

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'MISSED_CALL';
