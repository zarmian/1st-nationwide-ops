-- SMS notifications scaffolding.
--
-- 1. Five new NotificationKind values for the SMS use-cases:
--      SHIFT_REMINDER       Officer text 30-60 min before scheduled shift
--      JOB_REMINDER         Officer text 30-60 min before scheduled job
--      OFFICER_NO_SHOW      Dispatch text when shift / job is MISSED
--      ALARM_CUSTOMER_ACK   Customer text after admin approves alarm response
--      PAY_SUMMARY          Officer text at month-end with prior-month total
--
-- 2. Notification.bodyText — plain-text body the SMS driver sends.
--    WhatsApp rows use templateName / templateParams instead and leave
--    bodyText null.
--
-- 3. Customer.smsAlertsOn — opt-in for the alarm-ack SMS. Default false
--    so we never text a customer who hasn't agreed.

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SHIFT_REMINDER';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'JOB_REMINDER';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'OFFICER_NO_SHOW';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ALARM_CUSTOMER_ACK';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'PAY_SUMMARY';

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "bodyText" TEXT;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "smsAlertsOn" BOOLEAN NOT NULL DEFAULT false;
