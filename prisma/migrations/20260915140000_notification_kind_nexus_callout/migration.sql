-- New notification kind for imported Nexus dashboard callouts, so dispatch can
-- be alerted when new VPI callouts land overnight and need an officer. Added as
-- its own migration (no other statement uses the value in this transaction).
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'NEXUS_CALLOUT';
