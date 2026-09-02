"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import {
  upsertCustomerLogin,
  deactivateCustomerLogin,
  type CustomerLoginState,
} from "../_actions";

export type CustomerLoginInitial = {
  customerId: string;
  customerName: string;
  existing: { email: string; active: boolean } | null;
};

/**
 * Admin card for issuing / rotating a customer's read-only client-portal login.
 * One shared seat per customer: set an email + password and the client can
 * sign in at /login and land on /client. A new password rotates it; a new
 * email deactivates the old user row.
 */
export function CustomerLoginCard({
  initial,
}: {
  initial: CustomerLoginInitial;
}) {
  const action = upsertCustomerLogin.bind(null, initial.customerId);
  const [state, formAction] = useFormState<CustomerLoginState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};
  const [deactivating, startDeactivate] = useTransition();
  const [deactivateDone, setDeactivateDone] = useState(false);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Client portal login</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Issue or rotate the email + password for the client&apos;s read-only
          portal. They&apos;ll sign in at{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">/login</code> and
          land on{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">/client</code> —
          seeing only their own sites, activities and spend.
        </p>
      </div>

      {initial.existing && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="text-slate-500 text-xs">Current login</div>
            <div className="font-mono text-brand-navy">
              {initial.existing.email}
            </div>
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
          <p role="status" aria-live="polite" className="text-sm text-success">
            {state.success}
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="login-email">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="login-email"
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
            <label className="label" htmlFor="login-password">
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
              id="login-password"
              name="password"
              type="password"
              minLength={initial.existing ? 0 : 8}
              required={!initial.existing}
              className="input"
              autoComplete="new-password"
              placeholder={
                initial.existing ? "•••••••• (unchanged)" : "Min 8 characters"
              }
            />
            {fe.password?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.password[0]}</p>
            )}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="login-name">
            Display name (optional)
          </label>
          <input
            id="login-name"
            name="name"
            type="text"
            defaultValue={initial.customerName}
            className="input"
            maxLength={120}
          />
          <p className="text-xs text-slate-500 mt-1">
            Shown in the client&apos;s portal nav. Defaults to the customer name.
          </p>
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
                    "Deactivate this client's login? They won't be able to sign in until reactivated.",
                  )
                ) {
                  return;
                }
                startDeactivate(async () => {
                  await deactivateCustomerLogin(initial.customerId);
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
      {pending ? "Saving…" : hasExisting ? "Update login" : "Create login"}
    </button>
  );
}
