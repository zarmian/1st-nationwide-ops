/**
 * Pure callout types + enums shared by the DB creator (lib/callouts, which
 * pulls in Prisma) and the parser/resolver (lib/telegramCallout, which stays
 * DB-free so its matching logic is unit-testable). Keeping these here means
 * the resolver never transitively imports Prisma.
 */

export const BOT_CALLOUT_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "ADHOC",
] as const;
export type BotCalloutType = (typeof BOT_CALLOUT_TYPES)[number];

export const BOT_CALLOUT_SOURCES = [
  "ALARM",
  "PARTNER_REQUEST",
  "CUSTOMER_REQUEST",
  "AD_HOC",
] as const;
export type BotCalloutSource = (typeof BOT_CALLOUT_SOURCES)[number];

export type BotCalloutData = {
  siteId: string;
  type: BotCalloutType;
  typeLabel: string | null;
  source: BotCalloutSource;
  priority: "LOW" | "MEDIUM" | "HIGH";
  handlerKind: "officer" | "partner";
  assignedToUserId: string | null;
  handlerPartnerId: string | null;
  partnerOfficerName: string | null;
  scheduledFor: Date | null;
  notes: string | null;
};
