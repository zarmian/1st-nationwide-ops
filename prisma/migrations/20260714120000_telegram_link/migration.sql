-- Telegram bot account linking.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "telegramChatId"      TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkCode"    TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkExpires" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramChatId_key" ON "User"("telegramChatId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramLinkCode_key" ON "User"("telegramLinkCode");
