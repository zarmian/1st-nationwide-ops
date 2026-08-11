"use client";

import { useState, useTransition } from "react";

type RegisterResult = { ok: boolean; url?: string; error?: string };
type CheckResult = {
  ok: boolean;
  url?: string;
  pending?: number;
  lastError?: string;
  error?: string;
};

/**
 * Admin-only card that registers (and inspects) the Telegram webhook using
 * the server-side token + secret — so setting the bot live never means
 * pasting the token into a browser. Shown once the bot env vars are in.
 */
export function WebhookSetup({
  register,
  check,
}: {
  register: () => Promise<RegisterResult>;
  check: () => Promise<CheckResult>;
}) {
  const [registering, startRegister] = useTransition();
  const [checking, startCheck] = useTransition();
  const [registerResult, setRegisterResult] = useState<RegisterResult | null>(
    null,
  );
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Bot webhook (admin)</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          One-time step after the bot keys are set in the environment. This
          tells Telegram where to send messages — no need to touch a terminal.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setRegisterResult(null);
            startRegister(async () => setRegisterResult(await register()));
          }}
          disabled={registering}
          className="btn-primary text-sm"
        >
          {registering ? "Setting up…" : "Set up / refresh webhook"}
        </button>
        <button
          type="button"
          onClick={() => {
            setCheckResult(null);
            startCheck(async () => setCheckResult(await check()));
          }}
          disabled={checking}
          className="btn-secondary text-sm"
        >
          {checking ? "Checking…" : "Check status"}
        </button>
      </div>

      {registerResult &&
        (registerResult.ok ? (
          <p role="status" aria-live="polite" className="text-sm text-success">
            ✅ Webhook set{registerResult.url ? ` → ${registerResult.url}` : ""}.
            The bot is live.
          </p>
        ) : (
          <p role="alert" className="text-sm text-red-600">
            {registerResult.error}
          </p>
        ))}

      {checkResult &&
        (checkResult.ok ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm space-y-1"
          >
            <div>
              <span className="text-slate-500">Registered URL:</span>{" "}
              <span className="font-mono text-xs break-all">
                {checkResult.url || "(none set)"}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Pending updates:</span>{" "}
              {checkResult.pending ?? 0}
            </div>
            {checkResult.lastError && (
              <div className="text-amber-700">
                Last error: {checkResult.lastError}
              </div>
            )}
          </div>
        ) : (
          <p role="alert" className="text-sm text-red-600">
            {checkResult.error}
          </p>
        ))}
    </div>
  );
}
