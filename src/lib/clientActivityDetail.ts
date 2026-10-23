/**
 * One activity for the client dashboard — its times, charge and the officer's
 * report — scoped to ONE customer (through the site) and client-safe in the
 * same way as lib/clientPortal.ts: no pay, subcontractor costs, internal
 * notes, codes or GPS. Report payloads go through clientReportBody.
 */
import { prisma } from "@/lib/db";
import { parseFields } from "@/lib/formTemplates";
import {
  clientReportBody,
  type ClientReportField,
  type ClientReportPhoto,
} from "@/lib/clientReports";
import {
  jobKindLabel,
  jobStatus,
  pendingStatus,
  type ClientActivityStatus,
} from "@/lib/clientPortal";
import { isUuid } from "@/lib/clientPreview";

export type ActivityKind = "job" | "visit" | "shift";

export function isActivityKind(s: string): s is ActivityKind {
  return s === "job" || s === "visit" || s === "shift";
}

export type ClientReport = {
  id: string;
  title: string;
  submittedAt: Date;
  arrivedAt: Date | null;
  departedAt: Date | null;
  /** A FastField report: its answers, shown as filed. */
  fastfield: { answers: unknown; photoUrls: string[] } | null;
  fields: ClientReportField[];
  photos: ClientReportPhoto[];
  signatureUrl: string | null;
};

export type ClientCheckIn = {
  at: Date;
  /** Within the site's geofence when checking in; null when not checked. */
  onSite: boolean | null;
  photos: ClientReportPhoto[];
};

export type ClientActivityDetail = {
  kind: ActivityKind;
  id: string;
  label: string;
  site: { id: string; name: string; code: string | null; address: string };
  status: ClientActivityStatus;
  times: { label: string; at: Date }[];
  /** What we charged, ex VAT; null until priced. */
  charge: number | null;
  /** The invoice it's on, once that invoice has been sent. */
  invoiceNumber: string | null;
  reports: ClientReport[];
  checkIns: ClientCheckIn[];
  /** Photos on the visit itself, not already in a report. */
  photos: ClientReportPhoto[];
};

const SUBMISSION_SELECT = {
  id: true,
  form: true,
  submittedAt: true,
  arrivedAt: true,
  departedAt: true,
  payload: true,
  formTemplate: { select: { fields: true } },
  fastfieldReport: { select: { answers: true, photoUrls: true, form: { select: { name: true } } } },
} as const;

type SubmissionRow = {
  id: string;
  form: string;
  submittedAt: Date;
  arrivedAt: Date | null;
  departedAt: Date | null;
  payload: unknown;
  formTemplate: { fields: unknown } | null;
  fastfieldReport: { answers: unknown; photoUrls: string[]; form: { name: string } } | null;
};

const SITE_SELECT = {
  id: true,
  name: true,
  code: true,
  addressLine: true,
  postcodeFormatted: true,
} as const;

function siteOf(s: {
  id: string;
  name: string;
  code: string | null;
  addressLine: string;
  postcodeFormatted: string;
}) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    address: [s.addressLine, s.postcodeFormatted].filter(Boolean).join(", "),
  };
}

function money(d: unknown): number | null {
  if (d == null) return null;
  const n = Number(d as any);
  return Number.isFinite(n) ? n : null;
}

function sentInvoice(inv: { number: string; status: string } | null): string | null {
  return inv && (inv.status === "SENT" || inv.status === "PAID") ? inv.number : null;
}

function toReport(s: SubmissionRow): ClientReport {
  if (s.fastfieldReport) {
    return {
      id: s.id,
      title: s.fastfieldReport.form.name.trim() || "Officer report",
      submittedAt: s.submittedAt,
      arrivedAt: s.arrivedAt,
      departedAt: s.departedAt,
      fastfield: { answers: s.fastfieldReport.answers, photoUrls: s.fastfieldReport.photoUrls },
      fields: [],
      photos: [],
      signatureUrl: null,
    };
  }
  const body = clientReportBody(s.payload, parseFields(s.formTemplate?.fields));
  return {
    id: s.id,
    title: "Officer report",
    submittedAt: s.submittedAt,
    arrivedAt: s.arrivedAt,
    departedAt: s.departedAt,
    fastfield: null,
    ...body,
  };
}

function toCheckIn(s: SubmissionRow): ClientCheckIn {
  const p = (s.payload ?? {}) as { withinGeofence?: unknown };
  return {
    at: s.submittedAt,
    onSite: typeof p.withinGeofence === "boolean" ? p.withinGeofence : null,
    photos: clientReportBody(s.payload).photos,
  };
}

function hasContent(r: ClientReport): boolean {
  return Boolean(r.fastfield || r.fields.length || r.photos.length || r.signatureUrl);
}

/** FALSE_ALARM → "False alarm". */
function outcomeLabel(o: string): string {
  return o.charAt(0) + o.slice(1).toLowerCase().replace(/_/g, " ");
}

/** One activity on this customer's sites, or null (not theirs, not found,
 *  or not shown to clients — cancelled, missed). */
export async function loadClientActivityDetail(
  customerId: string,
  kind: ActivityKind,
  id: string,
): Promise<ClientActivityDetail | null> {
  if (!isUuid(id)) return null;
  const site = { is: { customerId } };

  if (kind === "job") {
    const j = await prisma.job.findFirst({
      where: { id, site, status: { not: "CANCELLED" } },
      select: {
        id: true,
        type: true,
        typeLabel: true,
        status: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        billedAmount: true,
        invoice: { select: { number: true, status: true } },
        site: { select: SITE_SELECT },
        alarmEvent: { select: { receivedAt: true, zone: true, outcome: true } },
        formSubmissions: { orderBy: { submittedAt: "asc" }, select: SUBMISSION_SELECT },
      },
    });
    if (!j?.site) return null;
    const times: { label: string; at: Date }[] = [];
    if (j.alarmEvent) times.push({ label: "Alarm received", at: j.alarmEvent.receivedAt });
    if (j.scheduledFor && !j.alarmEvent) times.push({ label: "Booked for", at: j.scheduledFor });
    if (j.startedAt) times.push({ label: "Officer on site", at: j.startedAt });
    if (j.completedAt) times.push({ label: "Finished", at: j.completedAt });
    const reports = (j.formSubmissions as SubmissionRow[]).map(toReport).filter(hasContent);
    if (j.alarmEvent?.zone || j.alarmEvent?.outcome) {
      const fields: ClientReportField[] = [];
      if (j.alarmEvent.zone) fields.push({ label: "Alarm zone", value: j.alarmEvent.zone });
      if (j.alarmEvent.outcome) fields.push({ label: "Outcome", value: outcomeLabel(j.alarmEvent.outcome) });
      reports.unshift({
        id: "alarm",
        title: "Alarm",
        submittedAt: j.alarmEvent.receivedAt,
        arrivedAt: null,
        departedAt: null,
        fastfield: null,
        fields,
        photos: [],
        signatureUrl: null,
      });
    }
    return {
      kind,
      id: j.id,
      label: jobKindLabel(j.type, j.typeLabel),
      site: siteOf(j.site),
      status: jobStatus(j.status),
      times,
      charge: money(j.billedAmount),
      invoiceNumber: sentInvoice(j.invoice),
      reports,
      checkIns: [],
      photos: [],
    };
  }

  if (kind === "visit") {
    const v = await prisma.patrolVisit.findFirst({
      where: { id, site, status: { notIn: ["CANCELLED", "MISSED", "LATE"] } },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        arrivedAt: true,
        departedAt: true,
        photoUrls: true,
        billedAmount: true,
        invoice: { select: { number: true, status: true } },
        patrolSchedule: { select: { kind: true } },
        site: { select: SITE_SELECT },
        formSubmissions: { orderBy: { submittedAt: "asc" }, select: SUBMISSION_SELECT },
      },
    });
    if (!v) return null;
    const reports = (v.formSubmissions as SubmissionRow[]).map(toReport).filter(hasContent);
    const inReports = new Set(
      reports.flatMap((r) => [...r.photos.map((p) => p.url), ...(r.fastfield?.photoUrls ?? [])]),
    );
    const times: { label: string; at: Date }[] = [{ label: "Scheduled for", at: v.scheduledAt }];
    if (v.arrivedAt) times.push({ label: "Officer arrived", at: v.arrivedAt });
    if (v.departedAt) times.push({ label: "Officer left", at: v.departedAt });
    return {
      kind,
      id: v.id,
      label: v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol",
      site: siteOf(v.site),
      status: pendingStatus(v.status),
      times,
      charge: money(v.billedAmount),
      invoiceNumber: sentInvoice(v.invoice),
      reports,
      checkIns: [],
      photos: v.photoUrls.filter((u) => !inReports.has(u)).map((url) => ({ url, caption: null })),
    };
  }

  const sh = await prisma.shift.findFirst({
    where: { id, site, status: { notIn: ["MISSED", "ABANDONED"] } },
    select: {
      id: true,
      type: true,
      status: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      actualStartedAt: true,
      actualEndedAt: true,
      billedAmount: true,
      invoice: { select: { number: true, status: true } },
      site: { select: SITE_SELECT },
      formSubmissions: { orderBy: { submittedAt: "asc" }, select: SUBMISSION_SELECT },
    },
  });
  if (!sh) return null;
  const subs = sh.formSubmissions as SubmissionRow[];
  const times: { label: string; at: Date }[] = [
    { label: "Booked from", at: sh.scheduledStartsAt },
    { label: "Booked until", at: sh.scheduledEndsAt },
  ];
  if (sh.actualStartedAt) times.push({ label: "Started", at: sh.actualStartedAt });
  if (sh.actualEndedAt) times.push({ label: "Ended", at: sh.actualEndedAt });
  return {
    kind: "shift",
    id: sh.id,
    label: sh.type === "DOG_HANDLER" ? "Dog handler" : "Static guarding",
    site: siteOf(sh.site),
    status: pendingStatus(sh.status),
    times,
    charge: money(sh.billedAmount),
    invoiceNumber: sentInvoice(sh.invoice),
    reports: subs.filter((s) => s.form !== "SHIFT_CHECK").map(toReport).filter(hasContent),
    checkIns: subs.filter((s) => s.form === "SHIFT_CHECK").map(toCheckIn),
    photos: [],
  };
}
