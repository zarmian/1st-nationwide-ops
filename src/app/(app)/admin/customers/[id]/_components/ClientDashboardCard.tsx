"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Copy, Check, Eye } from "lucide-react";
import { FormError } from "@/components/FormError";
import { formatDateTime } from "@/lib/dates";
import {
  saveClientDomains,
  setClientUserActive,
  startClientPreview,
  type ClientDomainsState,
} from "../_actions";

export type ClientDashboardPerson = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: Date | null;
};

/**
 * Admin card for a customer's client dashboard (/client): which email
 * domains may sign in with an emailed link, the link to send, a preview, and
 * everyone who has signed in (block / unblock).
 */
export function ClientDashboardCard({
  customerId,
  customerName,
  domains,
  loginUrl,
  people,
}: {
  customerId: string;
  customerName: string;
  domains: string[];
  loginUrl: string;
  people: ClientDashboardPerson[];
}) {
  const [state, formAction] = useFormState<ClientDomainsState, FormData>(
    saveClientDomains.bind(null, customerId),
    {},
  );
  const on = domains.length > 0;

  return (
    <div className="card p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-brand-navy">Client dashboard</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {customerName}&rsquo;s own read-only view of their activities, reports and charges.
          They sign in with a link emailed to their work address. There&rsquo;s no password.
        </p>
      </div>

      <form action={formAction} className="space-y-2">
        <label className="label" htmlFor="client-domains">
          Who can sign in: email addresses at
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <input
            key={domains.join(",")}
            id="client-domains"
            name="domains"
            defaultValue={domains.join(", ")}
            placeholder="e.g. shurgard.co.uk, shurgard.com…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="input flex-1 min-w-[16rem]"
            aria-describedby="client-domains-hint"
          />
          <SaveButton />
        </div>
        <p id="client-domains-hint" className="text-xs text-slate-500">
          The part after the @. Anyone at these domains can sign in. Leave it empty to turn
          sign-in off.
        </p>
        <FormError message={state.error} />
        {state.success && (
          <p role="status" className="text-sm text-emerald-700">
            {state.success}
          </p>
        )}
      </form>

      {on && <ShareLink url={loginUrl} />}

      <form action={startClientPreview.bind(null, customerId)}>
        <button type="submit" className="btn-secondary inline-flex items-center gap-1.5">
          <Eye size={15} aria-hidden />
          Preview their dashboard
        </button>
      </form>

      <div>
        <h3 className="text-sm font-semibold text-brand-navy mb-2">
          People who have signed in
        </h3>
        {people.length === 0 ? (
          <p className="text-sm text-slate-500">Nobody yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Last signed in</th>
                  <th>
                    <span className="sr-only">Access</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td className="text-slate-800">{p.name}</td>
                    <td className="text-slate-600 break-all">{p.email}</td>
                    <td className="whitespace-nowrap text-slate-600">
                      {p.lastLoginAt ? formatDateTime(p.lastLoginAt) : "—"}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {!p.active && <span className="chip-red mr-2">Blocked</span>}
                      <form
                        action={setClientUserActive.bind(null, customerId, p.id, !p.active)}
                        className="inline"
                      >
                        <BlockButton active={p.active} name={p.name} />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

function BlockButton({ active, name }: { active: boolean; name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm font-medium text-brand-blue-dark hover:underline disabled:opacity-60"
      aria-label={active ? `Block ${name}` : `Unblock ${name}`}
    >
      {active ? "Block" : "Unblock"}
    </button>
  );
}

function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="label">Link to send them</div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-brand-navy break-all">
          {url}
        </code>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}
