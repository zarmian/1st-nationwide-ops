/**
 * What attaching a FastField report changes on a job or patrol visit, and
 * what taking it off again (a person's Unlink) puts back. Pure rules — the
 * database work is in fastfieldImport.ts (linkReportToJob /
 * linkReportToVisit / createJobForReport / unlinkReportFromActivity).
 *
 * A link writes exactly what it changed (`LinkPrev`) on the activity's
 * history (ActivityLog `fastfield_linked`, diff `{ fastfieldReportId,
 * byHand, prev }`). Unlink reads it back and undoes the link only where it
 * is safe: the activity has no other report, isn't on an invoice, hasn't
 * been moved on to another status since, and each field still holds what
 * the link put in. Anything it can't undo is listed for the person to check.
 *
 * History holds ids, times and yes/no flags only — never answers, client
 * details or money.
 */

/** What a link filled in on an activity (each was empty before), with the
 *  value it put in where Unlink must check it's still there. */
export type LinkFilled = {
  /** Jobs: the start / finish time put in (ISO). */
  startedAt?: string;
  completedAt?: string;
  /** Visits: the arrival / departure time put in (ISO). */
  arrivedAt?: string;
  departedAt?: string;
  /** The location put in, known by the time it is from (locatedAt, ISO). */
  locatedAt?: string;
  /** The officer put on it. */
  officerId?: string;
  /** Jobs: the responder type set together with the officer. */
  responderType?: string;
  /** Visits: the report's photos were put on it. */
  photos?: true;
  /** The bill / the officer's pay were filled in. */
  bill?: true;
  pay?: true;
};

/** Everything one link changed on a job or visit. */
export type LinkPrev = {
  /** The status before the link — only when the link changed it. */
  status?: string;
  /** The status straight after the link. If it's different at Unlink,
   *  someone has moved the activity on since, and it's left alone. */
  statusAfter: string;
  /** Linked by hand to work a link must not change — cancelled, or a job
   *  that stands for a shift: nothing on it was changed (and Unlink has
   *  nothing to undo). */
  cancelled?: true;
  filled: LinkFilled;
};

/** The report's side of a link: times, place and officer it brings. */
export type ReportFill = {
  /** When the officer got there — the arrival typed on the form, if any. */
  arrived: Date | null;
  /** When they were done — the departure typed on the form, if any. Only
   *  typed times are ever written: never the phone's times or the send time. */
  done: Date | null;
  lat: number | null;
  lng: number | null;
  /** The time the report's location is from (jobs): the typed arrival, if any. */
  locatedAt: Date | null;
  /** The officer the report names, if recognised. */
  officerId: string | null;
  /** Photos copied from the report. */
  photoUrls: string[];
};

const iso = (d: Date) => d.toISOString();

// ── Linking ───────────────────────────────────────────────────────────────

/** A job as the link finds it (read under a row lock). */
export type JobBefore = {
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  lat: number | null;
  assignedToUserId: string | null;
  handledByPartnerId: string | null;
  responderType: string | null;
};

export type JobLinkData = {
  status?: "APPROVED";
  startedAt?: Date;
  completedAt?: Date;
  lat?: number;
  lng?: number | null;
  locatedAt?: Date;
  assignedToUserId?: string;
  responderType?: "INTERNAL_OFFICER";
};

/**
 * What linking a report to a job changes: the job becomes done (APPROVED)
 * when `complete` (its status is one a report finishes), its empty start /
 * finish times, location and officer are filled from the report. A
 * cancelled job is left exactly as it is (only a person can link one).
 * Billing is filled separately and added to `prev.filled`.
 */
export function planJobLink(
  job: JobBefore,
  r: ReportFill,
  complete: boolean,
): { data: JobLinkData; prev: LinkPrev } {
  if (job.status === "CANCELLED") {
    return { data: {}, prev: { statusAfter: job.status, cancelled: true, filled: {} } };
  }
  const data: JobLinkData = {};
  const filled: LinkFilled = {};
  if (complete) data.status = "APPROVED";
  if (!job.startedAt && r.arrived) {
    data.startedAt = r.arrived;
    filled.startedAt = iso(r.arrived);
  }
  if (!job.completedAt && r.done) {
    data.completedAt = r.done;
    filled.completedAt = iso(r.done);
  }
  if (job.lat == null && r.lat != null) {
    data.lat = r.lat;
    data.lng = r.lng;
    if (r.locatedAt) {
      data.locatedAt = r.locatedAt;
      filled.locatedAt = iso(r.locatedAt);
    }
  }
  if (!job.assignedToUserId && !job.handledByPartnerId && r.officerId != null) {
    data.assignedToUserId = r.officerId;
    filled.officerId = r.officerId;
    if (job.responderType == null) {
      data.responderType = "INTERNAL_OFFICER";
      filled.responderType = "INTERNAL_OFFICER";
    }
  }
  return {
    data,
    prev: {
      ...(data.status ? { status: job.status } : {}),
      statusAfter: data.status ?? job.status,
      filled,
    },
  };
}

/** A patrol visit as the link finds it (read under a row lock). */
export type VisitBefore = {
  status: string;
  officerId: string | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  lat: number | null;
  photoUrls: string[];
  handledByPartnerId: string | null;
};

export type VisitLinkData = {
  status?: "COMPLETED";
  arrivedAt?: Date;
  departedAt?: Date;
  lat?: number;
  lng?: number | null;
  locatedAt?: Date;
  photoUrls?: string[];
  officerId?: string;
};

/**
 * What linking a report to a patrol visit changes: the visit is completed
 * when `complete`, its empty arrival / departure are filled (arrival = the
 * report's arrival, else its finish), and its empty location, photos and
 * officer come from the report. A cancelled visit is left as it is.
 */
export function planVisitLink(
  v: VisitBefore,
  r: ReportFill,
  complete: boolean,
): { data: VisitLinkData; prev: LinkPrev } {
  if (v.status === "CANCELLED") {
    return { data: {}, prev: { statusAfter: v.status, cancelled: true, filled: {} } };
  }
  const data: VisitLinkData = {};
  const filled: LinkFilled = {};
  // Typed times only (one typed time stands for both ends).
  const arrivedAt = v.arrivedAt ?? r.arrived ?? r.done;
  if (complete) data.status = "COMPLETED";
  if (!v.arrivedAt && arrivedAt) {
    data.arrivedAt = arrivedAt;
    filled.arrivedAt = iso(arrivedAt);
  }
  if (!v.departedAt && r.done) {
    data.departedAt = r.done;
    filled.departedAt = iso(r.done);
  }
  if (v.lat == null && r.lat != null) {
    data.lat = r.lat;
    data.lng = r.lng;
    if (arrivedAt) {
      data.locatedAt = arrivedAt;
      filled.locatedAt = iso(arrivedAt);
    }
  }
  if (v.photoUrls.length === 0 && r.photoUrls.length > 0) {
    data.photoUrls = r.photoUrls;
    filled.photos = true;
  }
  if (!v.officerId && !v.handledByPartnerId && r.officerId) {
    data.officerId = r.officerId;
    filled.officerId = r.officerId;
  }
  return {
    data,
    prev: {
      ...(data.status ? { status: v.status } : {}),
      statusAfter: data.status ?? v.status,
      filled,
    },
  };
}

/** A VPI schedule's visits are filed and priced as VPIs; every other visit
 *  as a patrol — the rule snapshotVisitFinanceIfNeeded (billing.ts) uses. */
export function visitKind(scheduleKind: string | null | undefined): "VPI" | "PATROL" {
  return scheduleKind === "VPI" ? "VPI" : "PATROL";
}

/** Read `prev` back from a `fastfield_linked` history row's diff; null when
 *  there is none (links made before linking kept a record) or it's unreadable. */
export function readLinkPrev(diff: unknown): LinkPrev | null {
  if (!diff || typeof diff !== "object") return null;
  const prev = (diff as { prev?: unknown }).prev;
  if (!prev || typeof prev !== "object") return null;
  const p = prev as Partial<LinkPrev>;
  if (typeof p.statusAfter !== "string" || !p.filled || typeof p.filled !== "object") return null;
  if (p.status != null && typeof p.status !== "string") return null;
  return p as LinkPrev;
}

// ── Unlinking ─────────────────────────────────────────────────────────────

/** A job or visit as Unlink finds it (read under a row lock). */
export type ActivityNow = {
  status: string;
  /** Jobs: startedAt / completedAt. Visits: arrivedAt / departedAt. */
  times: Partial<Record<"startedAt" | "completedAt" | "arrivedAt" | "departedAt", Date | null>>;
  locatedAt: Date | null;
  /** Jobs: assignedToUserId. Visits: officerId. */
  officerId: string | null;
  /** Jobs only. */
  responderType?: string | null;
  /** Visits only: its photos are still exactly the report's. */
  photosAreReports?: boolean;
  billed: boolean;
  paid: boolean;
  /** The invoice it's on, if any. */
  invoiceNumber: string | null;
  /** Other FastField reports or submissions (an officer's own report
   *  included) on it, besides the one coming off. */
  otherReports: number;
};

export type UndoPlan = {
  /** Fields to write on the activity (empty = leave it). */
  data: Record<string, unknown>;
  /** What was put back: "status", "startedAt", "location", "officer",
   *  "photos", "bill", "pay", "cancelled", … (for the history). */
  undone: string[];
  /** What the person should look at afterwards, in plain English. */
  check: string[];
};

const STATUS_WORD: Record<string, string> = {
  SENT_TO_CLIENT: "sent to the client",
  REVIEW_PENDING: "waiting for review",
};
const statusWord = (s: string) => STATUS_WORD[s] ?? s.toLowerCase().replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const TIME_WORD = {
  startedAt: "start time",
  completedAt: "finish time",
  arrivedAt: "arrival time",
  departedAt: "departure time",
} as const;

const sameTime = (now: Date | null | undefined, put: string) =>
  now != null && now.getTime() === Date.parse(put);

const BILL_CLEARED = { billedAmount: null, billedCurrency: null, billedAt: null, payRateUnit: null };
const PAY_CLEARED = { paidAmount: null, paidCurrency: null, paidAt: null };

/**
 * What Unlink puts back on a job (`kind` "job") or visit ("visit") from the
 * link's record. `what` names it for the messages ("the callout",
 * "the patrol visit"). Nothing is changed when the link left no record,
 * when the activity is on an invoice, has another report, or was moved on to
 * another status since; otherwise each field goes back only if it still
 * holds what the link put in.
 */
export function planUnlinkUndo(
  kind: "job" | "visit",
  what: string,
  prev: LinkPrev | null,
  now: ActivityNow,
): UndoPlan {
  const plan: UndoPlan = { data: {}, undone: [], check: [] };
  const What = cap(what);
  if (!prev) {
    plan.check.push(
      `${What} was linked before the app kept a record of what linking changes, so nothing on it was put back — check its status, times, officer and bill.`,
    );
    return plan;
  }
  if (prev.cancelled) return plan; // it was left alone when linked
  if (now.invoiceNumber) {
    plan.check.push(
      `${What} is on invoice ${now.invoiceNumber}, so it was left as it is — adjust the invoice if it shouldn't have been billed.`,
    );
    return plan;
  }
  if (now.otherReports > 0) {
    plan.check.push(`${What} has another report, so it was left as it is.`);
    return plan;
  }
  if (now.status !== prev.statusAfter) {
    plan.check.push(
      `${What} was changed to "${statusWord(now.status)}" after the link, so it was left as it is — check its times, officer and bill.`,
    );
    return plan;
  }

  const d = plan.data;
  if (prev.status) {
    d.status = prev.status;
    plan.undone.push("status");
  }
  const timeKeys = kind === "job" ? (["startedAt", "completedAt"] as const) : (["arrivedAt", "departedAt"] as const);
  for (const key of timeKeys) {
    const put = prev.filled[key];
    if (!put) continue;
    if (sameTime(now.times[key], put)) {
      d[key] = null;
      plan.undone.push(key);
    } else if (now.times[key] != null) {
      plan.check.push(`The ${TIME_WORD[key]} on ${what} was changed after the link, so it was kept.`);
    }
  }
  if (prev.filled.locatedAt) {
    if (sameTime(now.locatedAt, prev.filled.locatedAt)) {
      Object.assign(d, { lat: null, lng: null, locatedAt: null });
      plan.undone.push("location");
    } else if (now.locatedAt != null) {
      plan.check.push(`The location on ${what} was changed after the link, so it was kept.`);
    }
  }
  if (prev.filled.officerId) {
    if (now.officerId === prev.filled.officerId) {
      d[kind === "job" ? "assignedToUserId" : "officerId"] = null;
      if (kind === "job" && prev.filled.responderType && now.responderType === prev.filled.responderType) {
        d.responderType = null;
      }
      plan.undone.push("officer");
    } else if (now.officerId != null) {
      plan.check.push(`The officer on ${what} was changed after the link, so they were kept.`);
    }
  }
  if (kind === "visit" && prev.filled.photos) {
    if (now.photosAreReports) {
      d.photoUrls = [];
      plan.undone.push("photos");
    } else {
      plan.check.push(`The photos on ${what} were changed after the link, so they were kept.`);
    }
  }
  if (prev.filled.bill && now.billed) {
    Object.assign(d, BILL_CLEARED);
    plan.undone.push("bill");
  }
  if (prev.filled.pay && now.paid) {
    Object.assign(d, PAY_CLEARED);
    plan.undone.push("pay");
  }
  return plan;
}

/** A job the report made, as Unlink finds it. */
export type CreatedJobNow = {
  status: string;
  billed: boolean;
  paid: boolean;
  invoiceNumber: string | null;
  otherReports: number;
};

/**
 * A job made from a report only existed for it: Unlink cancels it and clears
 * its bill and pay, as Cancel does — unless it's on an invoice, has another
 * report, or was closed since (Cancel refuses closed jobs too).
 */
export function planCreatedJobUndo(
  what: string,
  now: CreatedJobNow,
  by: { userId: string | null; at: Date },
): UndoPlan {
  const plan: UndoPlan = { data: {}, undone: [], check: [] };
  const What = cap(what);
  if (now.status === "CANCELLED") return plan;
  if (now.invoiceNumber) {
    plan.check.push(
      `${What} is on invoice ${now.invoiceNumber}, so it wasn't cancelled — adjust the invoice, then cancel it by hand if it shouldn't be there.`,
    );
    return plan;
  }
  if (now.otherReports > 0) {
    plan.check.push(`${What} has another report, so it wasn't cancelled.`);
    return plan;
  }
  if (now.status === "CLOSED" || now.status === "SENT_TO_CLIENT") {
    plan.check.push(
      `${What} was closed after it was made, so it wasn't cancelled — cancel it by hand if it shouldn't be there.`,
    );
    return plan;
  }
  Object.assign(plan.data, {
    status: "CANCELLED",
    cancelledAt: by.at,
    ...(by.userId ? { cancelledByUserId: by.userId } : {}),
    statusBeforeCancel: now.status,
    ...BILL_CLEARED,
    ...PAY_CLEARED,
  });
  plan.undone.push("cancelled");
  if (now.billed) plan.undone.push("bill");
  if (now.paid) plan.undone.push("pay");
  return plan;
}
