-- WhatsApp Business notifications

CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');
CREATE TYPE "NotificationKind" AS ENUM (
  'VISIT_STARTED',
  'VISIT_COMPLETED',
  'VISIT_LATE',
  'VISIT_MISSED',
  'ALARM_RECEIVED',
  'KEY_HANDOVER'
);
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "User" ADD COLUMN "whatsappNumber" TEXT;

CREATE TABLE "Notification" (
  "id"              UUID                  NOT NULL DEFAULT gen_random_uuid(),
  "channel"         "NotificationChannel" NOT NULL DEFAULT 'WHATSAPP',
  "kind"            "NotificationKind"    NOT NULL,
  "recipientUserId" UUID,
  "recipientNumber" TEXT,
  "templateName"    TEXT                  NOT NULL,
  "templateParams"  JSONB                 NOT NULL DEFAULT '[]',
  "bodyPreview"     TEXT,
  "status"          "NotificationStatus"  NOT NULL DEFAULT 'PENDING',
  "attempts"        INTEGER               NOT NULL DEFAULT 0,
  "error"           TEXT,
  "eventEntity"     TEXT,
  "eventEntityId"   TEXT,
  "sentAt"          TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)          NOT NULL,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");
CREATE INDEX "Notification_recipientUserId_idx" ON "Notification"("recipientUserId");
CREATE INDEX "Notification_eventEntity_eventEntityId_idx" ON "Notification"("eventEntity", "eventEntityId");
CREATE INDEX "Notification_kind_idx" ON "Notification"("kind");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
