import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_KINDS,
  defaultRoutingFor,
  isConfigurableKind,
  type NotifAudience,
  type NotifChannel,
  type NotifRouting,
} from "./notificationSettings";

// Map a channel/audience token to the routing flag it controls, so we can
// assert a default never enables something the panel wouldn't let you set.
const CHANNEL_FLAG: Record<NotifChannel, keyof NotifRouting> = {
  TELEGRAM: "viaTelegram",
  SMS: "viaSms",
  WHATSAPP: "viaWhatsapp",
};
const AUDIENCE_FLAG: Partial<Record<NotifAudience, keyof NotifRouting>> = {
  ADMIN: "toAdmin",
  DISPATCHER: "toDispatcher",
  OFFICER: "toOfficer",
};

describe("notification routing config", () => {
  it("has a unique entry per kind", () => {
    const kinds = NOTIFICATION_KINDS.map((m) => m.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("only enables channels/audiences it also exposes in the panel", () => {
    for (const meta of NOTIFICATION_KINDS) {
      const d = meta.defaults;
      // Every enabled channel default must be an offered channel.
      for (const ch of ["TELEGRAM", "SMS", "WHATSAPP"] as NotifChannel[]) {
        if (d[CHANNEL_FLAG[ch]]) {
          expect(
            meta.channels,
            `${meta.kind} defaults ${ch} on but doesn't offer it`,
          ).toContain(ch);
        }
      }
      // Every enabled audience default must be an offered audience.
      for (const aud of ["ADMIN", "DISPATCHER", "OFFICER"] as NotifAudience[]) {
        const flag = AUDIENCE_FLAG[aud]!;
        if (d[flag]) {
          expect(
            meta.audiences,
            `${meta.kind} defaults ${aud} on but doesn't offer it`,
          ).toContain(aud);
        }
      }
    }
  });

  it("gives every kind at least one channel and a way to reach someone", () => {
    for (const meta of NOTIFICATION_KINDS) {
      expect(meta.channels.length, `${meta.kind} offers no channel`).toBeGreaterThan(0);
      expect(meta.audiences.length, `${meta.kind} offers no audience`).toBeGreaterThan(0);
    }
  });

  it("keeps the historical defaults: office alerts → Telegram + WhatsApp to staff", () => {
    const alarm = defaultRoutingFor("ALARM_RECEIVED");
    expect(alarm).toMatchObject({
      enabled: true,
      toAdmin: true,
      toDispatcher: true,
      viaTelegram: true,
      viaWhatsapp: true,
      viaSms: false,
    });
  });

  it("keeps the historical defaults: officer reminders → SMS to the officer", () => {
    for (const kind of ["SHIFT_REMINDER", "JOB_REMINDER", "PAY_SUMMARY"] as const) {
      expect(defaultRoutingFor(kind)).toMatchObject({
        enabled: true,
        toOfficer: true,
        viaSms: true,
        viaTelegram: false,
      });
    }
  });

  it("keeps the historical defaults: no-show & missed call → SMS + Telegram to staff", () => {
    for (const kind of ["OFFICER_NO_SHOW", "MISSED_CALL"] as const) {
      expect(defaultRoutingFor(kind)).toMatchObject({
        enabled: true,
        toAdmin: true,
        toDispatcher: true,
        viaSms: true,
        viaTelegram: true,
      });
    }
  });

  it("recognises configurable kinds and falls back safely for others", () => {
    expect(isConfigurableKind("ALARM_RECEIVED")).toBe(true);
    // SHIFT_LINK exists in the enum but isn't in the panel.
    expect(isConfigurableKind("SHIFT_LINK")).toBe(false);
    // Unknown-to-panel kinds still get a safe enabled default.
    expect(defaultRoutingFor("SHIFT_LINK").enabled).toBe(true);
  });
});
