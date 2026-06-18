"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import {
  upsertPartnerOfficerLogin,
  deactivatePartnerOfficerLogin,
  type OfficerLoginState,
} from "../_actions";

export type LoginCardInitial = {
  officerId: string;
  officerName: string;
  existing: { email: string; active: boolean } | null;
};

/**
 * Issue or rotate the officer's mobile login. Phase 3 enables them to
 * sign into /partner/m/today and mark their assigned activities done.
 */
export function PartnerOfficerLoginCard({
  initial,
}: {
  initial: LoginCardInitial;
}) {
  const action = upsertPartnerOfficerLogin.bind(null, initial.officerId);
  const [state, formAction] = useFormState<OfficerLoginState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};
  const [deactivating, startDeactivate] = useTransition();
  const [deactivateDone, setDeactivateDone] = useState(false);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Mobile login</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Give {initial.officerName} a phone login at{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">/login</code>{" "}
          so they can see their assigned activities and mark them done from
          their phone.
        </p>
      </div>

      {initial.existing && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="text-slate-500 text-xs">Current login</div>
            <div className="font-mono text-brand-navy">{initial.existing.email}</div>
          </div>
          <span
            className={
              initial.existing.active && !deactivateDone
                ? "chip-mint text-[10px]"
                : "chip-slate text-[10px]"
            }
          >
            {initial.existing.active && !deactivateDone ? "Active" : "Inactive"}
          </span>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        <FormError message={state.error} />
        {state.success && (
          <p className="text-sm text-success">{state.success}</p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="off-email">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="off-email"
              name="email"
              type="email"
              defaultValue={initial.existing?.email ?? ""}
              required
              className="input"
              autoComplete="off"
            />
            {fe.email?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.email[0]}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="off-password">
              Password{" "}
              {initial.existing ? (
                <span className="text-xs text-slate-400 font-normal">
                  (leave blank to keep)
                </span>
              ) : (
                <span className="text-red-500">*</span>
              )}
            </label>
            <input
              id="off-password"
              name="password"
              type="password"
              minLength={initial.existing ? 0 : 8}
              required={!initial.existing}
              className="input"
              autoComplete="new-password"
              placeholder={initial.existing ? "•••••••• (unchanged)" : "Min 8 characters"}
            />
            {fe.password?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.password[0]}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SubmitButton hasExisting={!!initial.existing} />
          {initial.existing && initial.existing.active && !deactivateDone && (
            <button
              type="button"
              disabled={deactivating}
              onClick={() => {
                if (
                  !confirm(
                    `Deactivate ${initial.officerName}'s login? They won't be able to sign in until you reactivate.`,
                  )
                ) {
                  return;
                }
                startDeactivate(async () => {
                  await deactivatePartnerOfficerLogin(initial.officerId);
                  setDeactivateDone(true);
                });
              }}
              className="btn-danger text-sm"
            >
              {deactivating ? "Working…" : "Deactivate"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function SubmitButton({ hasExisting }: { hasExisting: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary text-sm" disabled={pending}>
      {pending
        ? "Saving…"
        : hasExisting
          ? "Update login"
          : "Create login"}
    </button>
  );
}
