"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { requestLink, type ClientLinkState } from "./_actions";

export function ClientLinkForm() {
  const [state, formAction] = useFormState<ClientLinkState, FormData>(requestLink, {});
  const [again, setAgain] = useState(0);

  if (state.sentTo && again === 0) {
    return (
      <div role="status" className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">Check your email</p>
          <p className="mt-1">
            If <span className="font-medium break-all">{state.sentTo}</span> can use the
            dashboard, a sign-in link is on its way. It works once and expires in 15 minutes.
          </p>
        </div>
        <p className="text-sm text-slate-500">
          Nothing after a few minutes? Check your junk folder, or{" "}
          <button
            type="button"
            className="font-medium text-brand-navy underline underline-offset-2 hover:text-brand-blue-dark"
            onClick={() => setAgain(1)}
          >
            try again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      action={(fd) => {
        setAgain(0);
        formAction(fd);
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={state.sentTo ?? ""}
          placeholder="name@company.co.uk…"
          className="input"
        />
      </div>
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}
