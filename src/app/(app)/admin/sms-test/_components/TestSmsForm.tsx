"use client";

import { useFormState, useFormStatus } from "react-dom";
import { sendTestSms, type TestSmsState } from "../_actions";
import { FormError } from "@/components/FormError";

const DEFAULT_BODY =
  "Test from 1st Nationwide Ops — if you got this, the SMS gateway is working.";

export function TestSmsForm({ configured }: { configured: boolean }) {
  const [state, formAction] = useFormState<TestSmsState, FormData>(
    sendTestSms,
    {},
  );
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="card p-5 space-y-4 max-w-xl">
      <FormError message={state.error} />

      {state.ok && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span className="font-medium">Sent.</span> Text handed to the gateway
          for {state.sentTo}
          {state.messageId ? (
            <>
              {" "}
              (ref{" "}
              <code className="text-xs bg-emerald-100 px-1 rounded">
                {state.messageId}
              </code>
              )
            </>
          ) : null}
          . It should arrive within a few seconds if the gateway phone is on and
          online.
        </div>
      )}

      <div>
        <label className="label" htmlFor="to">
          Mobile number
        </label>
        <input
          id="to"
          name="to"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="07700 900123"
          className="input"
          aria-describedby="to-hint"
          aria-invalid={fe.to ? true : undefined}
        />
        {fe.to ? (
          <p className="text-xs text-red-600 mt-1">{fe.to}</p>
        ) : (
          <p id="to-hint" className="text-xs text-slate-500 mt-1">
            UK mobiles (07…) are fine — we convert to +44 automatically.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="body">
          Message
        </label>
        <textarea
          id="body"
          name="body"
          rows={3}
          className="input"
          defaultValue={DEFAULT_BODY}
          maxLength={1000}
          aria-invalid={fe.body ? true : undefined}
        />
        {fe.body && <p className="text-xs text-red-600 mt-1">{fe.body}</p>}
      </div>

      <SubmitButton configured={configured} />
    </form>
  );
}

function SubmitButton({ configured }: { configured: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Sending…" : "Send test SMS"}
      </button>
      {!configured && (
        <span className="text-xs text-amber-700">
          Gateway not configured yet — sending will explain what to set.
        </span>
      )}
    </div>
  );
}
