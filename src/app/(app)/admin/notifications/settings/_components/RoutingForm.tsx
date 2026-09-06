"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  saveNotificationSettings,
  type RoutingSaveState,
} from "../_actions";
import type {
  NotifAudience,
  NotifChannel,
  NotifRouting,
  NotifKindMeta,
} from "@/lib/notificationSettings";

export type RoutingItem = {
  meta: NotifKindMeta;
  routing: NotifRouting;
  customised: boolean;
};
type Group = { name: string; items: RoutingItem[] };

const AUDIENCE_LABEL: Record<NotifAudience, string> = {
  ADMIN: "Admins",
  DISPATCHER: "Office",
  OFFICER: "Officer",
  CUSTOMER: "Customer",
};
const AUDIENCE_FIELD: Record<
  Exclude<NotifAudience, "CUSTOMER">,
  keyof NotifRouting
> = {
  ADMIN: "toAdmin",
  DISPATCHER: "toDispatcher",
  OFFICER: "toOfficer",
};
const CHANNEL_LABEL: Record<NotifChannel, string> = {
  TELEGRAM: "Telegram",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};
const CHANNEL_FIELD: Record<NotifChannel, keyof NotifRouting> = {
  TELEGRAM: "viaTelegram",
  SMS: "viaSms",
  WHATSAPP: "viaWhatsapp",
};

export function RoutingForm({ groups }: { groups: Group[] }) {
  const [state, formAction] = useFormState<RoutingSaveState, FormData>(
    saveNotificationSettings,
    {},
  );

  // Track only the enabled flags so a switched-off card visibly dims. The
  // per-audience / per-channel boxes stay uncontrolled (defaultChecked).
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.flatMap((g) => g.items.map((i) => [i.meta.kind, i.routing.enabled])),
    ),
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.ok && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Saved. New alerts will follow these rules from now on.
        </div>
      )}
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {state.error}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.name} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {group.name}
          </h2>
          <div className="space-y-3">
            {group.items.map(({ meta, routing }) => {
              const isOn = enabled[meta.kind] ?? routing.enabled;
              return (
                <div key={meta.kind} className="card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-brand-navy">
                        {meta.label}
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">
                        {meta.description}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        name={`${meta.kind}.enabled`}
                        className="checkbox"
                        defaultChecked={routing.enabled}
                        onChange={(e) =>
                          setEnabled((m) => ({
                            ...m,
                            [meta.kind]: e.target.checked,
                          }))
                        }
                      />
                      <span
                        className={isOn ? "text-emerald-700" : "text-slate-400"}
                      >
                        {isOn ? "On" : "Off"}
                      </span>
                    </label>
                  </div>

                  <div
                    className={
                      "grid sm:grid-cols-2 gap-4 mt-4 transition-opacity " +
                      (isOn ? "" : "opacity-40")
                    }
                  >
                    <fieldset>
                      <legend className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">
                        Who gets it
                      </legend>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {meta.audiences.map((aud) => {
                          if (aud === "CUSTOMER") {
                            return (
                              <span
                                key={aud}
                                className="text-sm text-slate-500 italic"
                              >
                                Customer (opted-in only)
                              </span>
                            );
                          }
                          const field = AUDIENCE_FIELD[aud];
                          return (
                            <label
                              key={aud}
                              className="flex items-center gap-1.5 text-sm cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                name={`${meta.kind}.${field}`}
                                className="checkbox"
                                defaultChecked={Boolean(routing[field])}
                              />
                              <span>{AUDIENCE_LABEL[aud]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>

                    <fieldset>
                      <legend className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">
                        How it's sent
                      </legend>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {meta.channels.map((ch) => {
                          const field = CHANNEL_FIELD[ch];
                          return (
                            <label
                              key={ch}
                              className="flex items-center gap-1.5 text-sm cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                name={`${meta.kind}.${field}`}
                                className="checkbox"
                                defaultChecked={Boolean(routing[field])}
                              />
                              <span>{CHANNEL_LABEL[ch]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-white via-white/95 to-transparent pt-4 pb-1">
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save routing"}
    </button>
  );
}
