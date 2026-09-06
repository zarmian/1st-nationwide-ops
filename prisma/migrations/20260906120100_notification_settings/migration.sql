-- Per-notification routing the admin can edit: who receives each kind
-- (admins / dispatchers / involved officer) and over which medium
-- (Telegram / SMS / WhatsApp). A missing row means "use the code default",
-- so behaviour is unchanged until the panel is saved.
CREATE TABLE "NotificationSetting" (
  "kind"            "NotificationKind" NOT NULL,
  "enabled"         BOOLEAN            NOT NULL DEFAULT true,
  "toAdmin"         BOOLEAN            NOT NULL DEFAULT false,
  "toDispatcher"    BOOLEAN            NOT NULL DEFAULT false,
  "toOfficer"       BOOLEAN            NOT NULL DEFAULT false,
  "viaTelegram"     BOOLEAN            NOT NULL DEFAULT false,
  "viaSms"          BOOLEAN            NOT NULL DEFAULT false,
  "viaWhatsapp"     BOOLEAN            NOT NULL DEFAULT false,
  "updatedByUserId" UUID,
  "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)       NOT NULL,
  CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("kind")
);
