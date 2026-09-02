-- Automated daily client report: per-customer opt-in + send audit log.

ALTER TABLE "Customer" ADD COLUMN "dailyReportOn"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "dailyReportRecipient" TEXT;

CREATE TABLE "ClientReportSend" (
  "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
  "reportKey"     TEXT           NOT NULL,
  "reportDate"    TIMESTAMP(3)   NOT NULL,
  "toAddress"     TEXT           NOT NULL,
  "subject"       TEXT,
  "status"        "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt"        TIMESTAMP(3),
  "failureReason" TEXT,
  "jobCount"      INTEGER        NOT NULL DEFAULT 0,
  "shiftCount"    INTEGER        NOT NULL DEFAULT 0,
  "triggeredBy"   TEXT,
  "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientReportSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientReportSend_reportKey_reportDate_idx" ON "ClientReportSend"("reportKey", "reportDate");
CREATE INDEX "ClientReportSend_status_idx" ON "ClientReportSend"("status");
