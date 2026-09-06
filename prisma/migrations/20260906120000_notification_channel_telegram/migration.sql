-- Add TELEGRAM as a notification channel so Telegram sends can be recorded
-- (and de-duplicated) as Notification rows, alongside WhatsApp and SMS.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'TELEGRAM';
