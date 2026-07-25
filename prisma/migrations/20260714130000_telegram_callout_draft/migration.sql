-- Telegram bot: parsed-but-unconfirmed callouts awaiting a Confirm/Cancel tap.

CREATE TABLE "TelegramCalloutDraft" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "chatId"          TEXT         NOT NULL,
  "createdByUserId" UUID         NOT NULL,
  "payload"         JSONB        NOT NULL,
  "summary"         TEXT         NOT NULL,
  "status"          TEXT         NOT NULL DEFAULT 'PENDING',
  "messageId"       INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramCalloutDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelegramCalloutDraft_chatId_status_idx" ON "TelegramCalloutDraft"("chatId", "status");
CREATE INDEX "TelegramCalloutDraft_expiresAt_idx" ON "TelegramCalloutDraft"("expiresAt");

ALTER TABLE "TelegramCalloutDraft"
  ADD CONSTRAINT "TelegramCalloutDraft_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
