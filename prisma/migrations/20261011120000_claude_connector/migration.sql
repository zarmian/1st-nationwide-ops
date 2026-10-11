-- Claude connector (MCP). The app acts as its own OAuth 2.1 authorisation
-- server for Claude: approved connections, single-use authorisation codes,
-- hashed bearer tokens, a tool-call audit trail and one settings row.
-- Additive only — no existing table changes.

CREATE TYPE "McpTokenKind" AS ENUM ('ACCESS', 'REFRESH');

CREATE TABLE "McpGrant" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "userId"          UUID         NOT NULL,
  "clientId"        TEXT         NOT NULL,
  "clientName"      TEXT         NOT NULL,
  "redirectHost"    TEXT         NOT NULL,
  "scope"           TEXT         NOT NULL,
  "resource"        TEXT         NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"      TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "revokedByUserId" UUID,
  CONSTRAINT "McpGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "McpGrant_userId_idx" ON "McpGrant"("userId");
CREATE INDEX "McpGrant_revokedAt_idx" ON "McpGrant"("revokedAt");
ALTER TABLE "McpGrant" ADD CONSTRAINT "McpGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "McpAuthCode" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "codeHash"      TEXT         NOT NULL,
  "grantId"       UUID         NOT NULL,
  "redirectUri"   TEXT         NOT NULL,
  "codeChallenge" TEXT         NOT NULL,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "usedAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpAuthCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "McpAuthCode_codeHash_key" ON "McpAuthCode"("codeHash");
CREATE INDEX "McpAuthCode_grantId_idx" ON "McpAuthCode"("grantId");
ALTER TABLE "McpAuthCode" ADD CONSTRAINT "McpAuthCode_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "McpGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "McpToken" (
  "id"        UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tokenHash" TEXT           NOT NULL,
  "kind"      "McpTokenKind" NOT NULL,
  "grantId"   UUID           NOT NULL,
  "expiresAt" TIMESTAMP(3)   NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "McpToken_tokenHash_key" ON "McpToken"("tokenHash");
CREATE INDEX "McpToken_grantId_kind_idx" ON "McpToken"("grantId", "kind");
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "McpGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "McpToolCall" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "grantId"    UUID,
  "userId"     UUID         NOT NULL,
  "tool"       TEXT         NOT NULL,
  "args"       JSONB,
  "ok"         BOOLEAN      NOT NULL,
  "error"      TEXT,
  "durationMs" INTEGER      NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpToolCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "McpToolCall_createdAt_idx" ON "McpToolCall"("createdAt");
CREATE INDEX "McpToolCall_userId_createdAt_idx" ON "McpToolCall"("userId", "createdAt");
ALTER TABLE "McpToolCall" ADD CONSTRAINT "McpToolCall_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "McpGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "McpSettings" (
  "id"               INTEGER      NOT NULL DEFAULT 1,
  "allowDispatchers" BOOLEAN      NOT NULL DEFAULT false,
  "updatedByUserId"  UUID,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpSettings_pkey" PRIMARY KEY ("id")
);
