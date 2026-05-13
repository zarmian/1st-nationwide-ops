"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  billForSite,
  jobTypeToRateService,
} from "@/lib/billing";
import { notifyAlarmReceived } from "@/lib/notifications";

const JOB_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "VPI",
  "ADHOC",
] as const;

const JOB_SOURCES = [
  "SCHEDULED",
  "ALARM",
  "PARTNER_REQUEST",
  "CUSTOMER_REQUEST",
  "ONBOARDING",
  "AD_HOC",
] as const;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const ALARM_SOURCES = [
  "ARC_EMAIL",
  "ARC_PHONE",
  "PARTNER_EMAIL",
  "PARTNER_PHONE",
  "CUSTOMER_PHONE",
  "MANUAL",
  "WEBHOOK",
] as const;

const NewJobInput = z
  .object({
    siteId: z.string().uuid("Pick a site"),
    type: z.enum(JOB_TYPES),
    source: z.enum(JOB_SOURCES),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    scheduledFor: z.string().optional().nullable(),
    assignedToUserId: z.string().uuid().or(z.literal("")).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    reportedViaPartnerApp: z.boolean().default(false),
    partnerReportRef: z.string().trim().max(200).optional().nullable(),
    // alarm-specific (only used when type === ALARM_RESPONSE)
    alarmSource: z.enum(ALARM_SOURCES).optional().nullable(),
    alarmZone: z.string().trim().max(120).optional().nullable(),
    alarmRawSubject: z.string().trim().max(500).optional().nullable(),
    alarmRawBody: z.string().trim().max(5000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.type === "ALARM_RESPONSE" && !d.alarmSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alarmSource"],
        message: "Alarm source is required for alarm response jobs",
      });
    }
  });

export type NewJobState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseForm(formData: FormData) {
  const raw = {
    siteId: formData.get("siteId")?.toString() ?? "",
    type: formData.get("type")?.toString() ?? "ADHOC",
    source: formData.get("source")?.toString() ?? "CUSTOMER_REQUEST",
    priority: formData.get("priority")?.toString() ?? "MEDIUM",
    scheduledFor: formData.get("scheduledFor")?.toString() || null,
    assignedToUserId: formData.get("assignedToUserId")?.toString() || null,
    notes: formData.get("notes")?.toString() || null,
    reportedViaPartnerApp: formData.get("reportedViaPartnerApp") === "on",
    partnerReportRef: formData.get("partnerReportRef")?.toString() || null,
    alarmSource: formData.get("alarmSource")?.toString() || null,
    alarmZone: formData.get("alarmZone")?.toString() || null,
    alarmRawSubject: formData.get("alarmRawSubject")?.toString() || null,
    alarmRawBody: formData.get("alarmRawBody")?.toString() || null,
  };
  return NewJobInput.safeParse(raw);
}

export async function createJob(
  _prev: NewJobState,
  formData: FormData,
): Promise<NewJobState> {
  const me = await requireStaff();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  const site = await prisma.site.findUnique({
    where: { id: d.siteId },
    select: { id: true, customerId: true, partnerId: true, active: true },
  });
  if (!site) {
    return { error: "Site not found.", fieldErrors: { siteId: ["Unknown"] } };
  }
  if (!site.active) {
    return {
      error: "Site is inactive.",
      fieldErrors: { siteId: ["Site is not currently active"] },
    };
  }

  // For alarm responses, write the AlarmEvent first and link it on the job.
  let alarmEventId: string | null = null;
  if (d.type === "ALARM_RESPONSE") {
    const alarm = await prisma.alarmEvent.create({
      data: {
        siteId: d.siteId,
        source: d.alarmSource as any,
        zone: d.alarmZone,
        priority: d.priority as any,
        rawSubject: d.alarmRawSubject,
        rawBody: d.alarmRawBody,
        assignedToId: d.assignedToUserId || null,
      },
      select: { id: true },
    });
    alarmEventId = alarm.id;
  }

  const created = await prisma.job.create({
    data: {
      type: d.type as any,
      source: d.source as any,
      status: d.assignedToUserId ? ("ASSIGNED" as any) : ("OPEN" as any),
      priority: d.priority as any,
      siteId: d.siteId,
      customerId: site.customerId,
      partnerId: site.partnerId,
      responderType: "INTERNAL_OFFICER" as any,
      assignedToUserId: d.assignedToUserId || null,
      alarmEventId,
      scheduledFor: d.scheduledFor ? new Date(d.scheduledFor) : null,
      reportedViaPartnerApp: d.reportedViaPartnerApp,
      partnerReportRef: d.partnerReportRef,
      notes: d.notes,
    },
    select: { id: true },
  });

  // Best-effort billing snapshot. PER_HOUR types stay unbilled until
  // completion when we know actual hours.
  const rateService = jobTypeToRateService(d.type);
  if (rateService) {
    const result = await billForSite(d.siteId, rateService);
    if (result.ok) {
      await applyBillingToJob(created.id, result);
    }
  }

  if (alarmEventId) {
    notifyAlarmReceived(alarmEventId).catch((e) =>
      console.error("notifyAlarmReceived failed", e),
    );
  }

  revalidatePath("/dispatch");
  revalidatePath(`/sites/${d.siteId}`);
  redirect("/dispatch");
}
