import { z } from "zod";
import { parseUkDateTimeLocal } from "./dates";

/**
 * Pure validation + business rules for dispatcher-recorded callouts.
 * Lives in src/lib so it can be unit-tested without spinning up Prisma
 * or NextAuth — the server action in _actions.ts wraps these.
 */

// How far back a dispatcher can set the start time. Admin bypasses.
export const DISPATCHER_BACKDATE_DAYS = 30;

export const CALLOUT_JOB_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "ADHOC",
] as const;

export const CALLOUT_SOURCES = [
  "ALARM",
  "PARTNER_REQUEST",
  "CUSTOMER_REQUEST",
  "AD_HOC",
] as const;

export const HANDLER_KINDS = ["officer", "partner"] as const;
export type HandlerKind = (typeof HANDLER_KINDS)[number];

/**
 * Two branches:
 *   handlerKind="officer" → existing flow. Internal officer attended.
 *                            startedAt + completedAt required.
 *   handlerKind="partner" → we sub'd to a partner (Nexus, Keyholding Co).
 *                            handedOffAt required. Attendance times +
 *                            their guard name are optional — admin may
 *                            not know them yet.
 */
export const CalloutInput = z
  .object({
    siteId: z.string().uuid("Pick a site"),
    type: z.enum(CALLOUT_JOB_TYPES),
    source: z.enum(CALLOUT_SOURCES),
    handlerKind: z.enum(HANDLER_KINDS).default("officer"),
    officerId: z.string().trim().optional().nullable(),
    handlerPartnerId: z.string().trim().optional().nullable(),
    handedOffAt: z.string().trim().optional().nullable(),
    partnerOfficerName: z.string().trim().max(120).optional().nullable(),
    startedAt: z.string().trim().optional().nullable(),
    completedAt: z.string().trim().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    excludeFromClientReport: z.boolean().default(false),
    partnerReportRef: z.string().trim().max(200).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.handlerKind === "officer") {
      if (!d.officerId || !isUuid(d.officerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["officerId"],
          message: "Pick an officer.",
        });
      }
      if (!d.startedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startedAt"],
          message: "When did it start?",
        });
      }
      if (!d.completedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["completedAt"],
          message: "When did it finish?",
        });
      }
    } else {
      if (!d.handlerPartnerId || !isUuid(d.handlerPartnerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["handlerPartnerId"],
          message: "Pick the partner you gave it to.",
        });
      }
    }

    // Validate any datetime fields that were provided. Treat the form
    // values as UK wall-clock — they come from a <datetime-local> input
    // where the user typed UK time without a TZ suffix.
    const start = parseUkDateTimeLocal(d.startedAt);
    const end = parseUkDateTimeLocal(d.completedAt);
    const handed = parseUkDateTimeLocal(d.handedOffAt);

    if (start && Number.isNaN(start.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "Start time isn't a valid date.",
      });
    }
    if (end && Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "End time isn't a valid date.",
      });
    }
    if (handed && Number.isNaN(handed.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handedOffAt"],
        message: "Hand-off time isn't a valid date.",
      });
    }
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "End must be after start.",
      });
    }
    // Allow a minute of slop so clock-skew doesn't trip a dispatcher
    // who set 'started at = now' from their browser.
    const future = Date.now() + 60 * 1000;
    if (start && start.getTime() > future) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "Can't record a callout in the future.",
      });
    }
    if (handed && handed.getTime() > future) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handedOffAt"],
        message: "Hand-off time can't be in the future.",
      });
    }
  });

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

/**
 * Backdate gate. Returns null if the role can record a callout that
 * started at `startedAt`, otherwise a user-facing error message.
 * Admins bypass the cap — they handle rollout / historical data entry.
 */
export function checkBackdateAllowed(
  startedAt: Date,
  role: "ADMIN" | "DISPATCHER" | "OFFICER",
  now: Date = new Date(),
): string | null {
  if (role === "ADMIN") return null;
  const cutoff = now.getTime() - DISPATCHER_BACKDATE_DAYS * 24 * 60 * 60 * 1000;
  if (startedAt.getTime() < cutoff) {
    return `Dispatcher entries are limited to the last ${DISPATCHER_BACKDATE_DAYS} days. Ask an admin to record older callouts.`;
  }
  return null;
}
