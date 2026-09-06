/**
 * Notification routing — the admin-editable matrix behind every alert.
 *
 * For each NotificationKind we describe WHO can receive it (admins /
 * dispatchers / the involved officer / a customer) and WHICH mediums are
 * offered (Telegram / SMS / WhatsApp), plus the built-in default routing that
 * matches how the app behaved before the control panel existed.
 *
 * A row in `NotificationSetting` overrides the default for that kind. When no
 * row exists, the default applies — so nothing changes until an admin saves.
 * The notification helpers in lib/notifications.ts call `getNotificationRouting`
 * at fire time to decide recipients and channels.
 */
import { prisma } from "@/lib/db";
import type { NotificationKind } from "@prisma/client";

export type NotifAudience = "ADMIN" | "DISPATCHER" | "OFFICER" | "CUSTOMER";
export type NotifChannel = "TELEGRAM" | "SMS" | "WHATSAPP";

export type NotifRouting = {
  enabled: boolean;
  toAdmin: boolean;
  toDispatcher: boolean;
  toOfficer: boolean;
  viaTelegram: boolean;
  viaSms: boolean;
  viaWhatsapp: boolean;
};

export type NotifKindMeta = {
  kind: NotificationKind;
  label: string;
  description: string;
  /// UI grouping heading.
  group: string;
  /// Which recipient toggles are meaningful for this kind.
  audiences: NotifAudience[];
  /// Which mediums are offered for this kind.
  channels: NotifChannel[];
  defaults: NotifRouting;
};

/** Fill a routing object, defaulting every unset flag to off (enabled on). */
function routing(p: Partial<NotifRouting>): NotifRouting {
  return {
    enabled: true,
    toAdmin: false,
    toDispatcher: false,
    toOfficer: false,
    viaTelegram: false,
    viaSms: false,
    viaWhatsapp: false,
    ...p,
  };
}

const GROUP_DISPATCH = "Office & dispatch alerts";
const GROUP_OFFICER = "Messages to officers";
const GROUP_CUSTOMER = "Messages to customers";

// Office/dispatch broadcasts — historically WhatsApp + Telegram to all
// active admins & dispatchers.
const STAFF_AUDIENCES: NotifAudience[] = ["ADMIN", "DISPATCHER"];
const STAFF_CHANNELS: NotifChannel[] = ["TELEGRAM", "SMS", "WHATSAPP"];
const staffDefault = routing({
  toAdmin: true,
  toDispatcher: true,
  viaTelegram: true,
  viaWhatsapp: true,
});

/**
 * The catalogue. Order here is the order shown in the admin panel.
 */
export const NOTIFICATION_KINDS: NotifKindMeta[] = [
  {
    kind: "ALARM_RECEIVED",
    label: "Alarm received",
    description: "A new alarm activation has come in and needs a response.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: STAFF_CHANNELS,
    defaults: staffDefault,
  },
  {
    kind: "VISIT_STARTED",
    label: "Patrol started",
    description: "An officer has arrived on site for a patrol.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: STAFF_CHANNELS,
    defaults: staffDefault,
  },
  {
    kind: "VISIT_COMPLETED",
    label: "Patrol completed",
    description: "An officer has finished and left a patrol.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: STAFF_CHANNELS,
    defaults: staffDefault,
  },
  {
    kind: "VISIT_LATE",
    label: "Patrol running late",
    description: "A scheduled patrol hasn't started on time.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: STAFF_CHANNELS,
    defaults: staffDefault,
  },
  {
    kind: "VISIT_MISSED",
    label: "Patrol missed",
    description: "A scheduled patrol was missed entirely.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: STAFF_CHANNELS,
    defaults: staffDefault,
  },
  {
    kind: "SHIFT_CHECK_OVERDUE",
    label: "Guard check-in overdue",
    description:
      "A guard on a static/dog shift has missed their regular check-in.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: STAFF_CHANNELS,
    defaults: staffDefault,
  },
  {
    kind: "KEY_HANDOVER",
    label: "Key handover",
    description: "A key has changed hands. Also notifies the officers involved.",
    group: GROUP_DISPATCH,
    audiences: ["ADMIN", "DISPATCHER", "OFFICER"],
    channels: STAFF_CHANNELS,
    defaults: routing({
      toAdmin: true,
      toDispatcher: true,
      toOfficer: true,
      viaTelegram: true,
      viaWhatsapp: true,
    }),
  },
  {
    kind: "OFFICER_NO_SHOW",
    label: "Officer no-show",
    description:
      "An officer hasn't started a shift or job they were due on. Sent to the office.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: ["TELEGRAM", "SMS"],
    defaults: routing({
      toAdmin: true,
      toDispatcher: true,
      viaTelegram: true,
      viaSms: true,
    }),
  },
  {
    kind: "MISSED_CALL",
    label: "Missed phone call",
    description: "A caller rang the office line and no one answered.",
    group: GROUP_DISPATCH,
    audiences: STAFF_AUDIENCES,
    channels: ["TELEGRAM", "SMS"],
    defaults: routing({
      toAdmin: true,
      toDispatcher: true,
      viaTelegram: true,
      viaSms: true,
    }),
  },
  {
    kind: "SHIFT_REMINDER",
    label: "Shift reminder",
    description:
      "Reminds the assigned officer that a static/dog shift is coming up.",
    group: GROUP_OFFICER,
    audiences: ["OFFICER"],
    channels: ["SMS", "TELEGRAM"],
    defaults: routing({ toOfficer: true, viaSms: true }),
  },
  {
    kind: "JOB_REMINDER",
    label: "Job reminder",
    description:
      "Reminds the assigned officer that a scheduled job is coming up.",
    group: GROUP_OFFICER,
    audiences: ["OFFICER"],
    channels: ["SMS", "TELEGRAM"],
    defaults: routing({ toOfficer: true, viaSms: true }),
  },
  {
    kind: "PAY_SUMMARY",
    label: "Monthly pay summary",
    description:
      "Tells an officer how many activities they did and what they're owed.",
    group: GROUP_OFFICER,
    audiences: ["OFFICER"],
    channels: ["SMS", "TELEGRAM"],
    defaults: routing({ toOfficer: true, viaSms: true }),
  },
  {
    kind: "ALARM_CUSTOMER_ACK",
    label: "Alarm handled — customer text",
    description:
      "Lets a customer know an alarm at their site was attended. Only sent to customers who've opted in.",
    group: GROUP_CUSTOMER,
    audiences: ["CUSTOMER"],
    channels: ["SMS"],
    defaults: routing({ viaSms: true }),
  },
];

const META_BY_KIND = new Map<NotificationKind, NotifKindMeta>(
  NOTIFICATION_KINDS.map((m) => [m.kind, m]),
);

/** True for kinds that appear in the control panel (have a routing default). */
export function isConfigurableKind(kind: NotificationKind): boolean {
  return META_BY_KIND.has(kind);
}

/** The built-in default routing for a kind (used when no DB row exists). */
export function defaultRoutingFor(kind: NotificationKind): NotifRouting {
  return META_BY_KIND.get(kind)?.defaults ?? routing({ enabled: true });
}

type SettingRow = {
  enabled: boolean;
  toAdmin: boolean;
  toDispatcher: boolean;
  toOfficer: boolean;
  viaTelegram: boolean;
  viaSms: boolean;
  viaWhatsapp: boolean;
};

function rowToRouting(row: SettingRow): NotifRouting {
  return {
    enabled: row.enabled,
    toAdmin: row.toAdmin,
    toDispatcher: row.toDispatcher,
    toOfficer: row.toOfficer,
    viaTelegram: row.viaTelegram,
    viaSms: row.viaSms,
    viaWhatsapp: row.viaWhatsapp,
  };
}

/**
 * Effective routing for a kind: the saved row if there is one, else the code
 * default. Called at fire time by every notification helper.
 */
export async function getNotificationRouting(
  kind: NotificationKind,
): Promise<NotifRouting> {
  const row = await prisma.notificationSetting.findUnique({ where: { kind } });
  return row ? rowToRouting(row) : defaultRoutingFor(kind);
}

/** Every configurable kind with its effective routing — for the admin panel. */
export async function getAllNotificationRoutings(): Promise<
  { meta: NotifKindMeta; routing: NotifRouting; customised: boolean }[]
> {
  const rows = await prisma.notificationSetting.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return NOTIFICATION_KINDS.map((meta) => {
    const row = byKind.get(meta.kind);
    return {
      meta,
      routing: row ? rowToRouting(row) : meta.defaults,
      customised: Boolean(row),
    };
  });
}
