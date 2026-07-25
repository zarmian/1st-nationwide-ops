"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type GenerateResult = {
  ok: boolean;
  code?: string;
  link?: string;
  error?: string;
};

/**
 * Client card for linking / unlinking the signed-in user's Telegram.
 *
 * Flow: tap "Get my connect link" → server mints a one-time code (15-min
 * expiry) → we show a t.me deep link. Opening it in Telegram sends
 * `/start <code>` to the bot, which the webhook turns into a link. The
 * page is server-rendered, so a Disconnect / refresh reflects the new state.
 */
export function ConnectTelegram({
  linked,
  botConfigured,
  generate,
  disconnect,
}: {
  linked: boolean;
  botConfigured: boolean;
  generate: () => Promise<GenerateResult>;
  disconnect: () => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, startGenerate] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  function onGenerate() {
    setCopied(false);
    startGenerate(async () => {
      const r = await generate();
      setResult(r);
    });
  }

  function onDisconnect() {
    if (
      !confirm(
        "Disconnect Telegram? You'll stop getting alerts there until you link again.",
      )
    ) {
      return;
    }
    startDisconnect(async () => {
      await disconnect();
      setResult(null);
      router.refresh();
    });
  }

  async function copyLink(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible to copy by hand */
    }
  }

  if (linked) {
    return (
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">Telegram</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              This account is linked. Ops alerts will arrive in your Telegram
              chat with the bot.
            </p>
          </div>
          <span className="chip-mint text-[10px] whitespace-nowrap">
            Connected ✓
          </span>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="btn-danger text-sm"
        >
          {disconnecting ? "Working…" : "Disconnect"}
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Link your Telegram</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Connect once to get alerts in Telegram. Later you&apos;ll be able to
          create callouts just by messaging the bot.
        </p>
      </div>

      <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
        <li>Tap the button below to get your personal connect link.</li>
        <li>Open it — Telegram launches and shows the bot.</li>
        <li>
          Tap <b>Start</b> in Telegram. You&apos;re linked. Come back here and
          refresh.
        </li>
      </ol>

      <button
        type="button"
        onClick={onGenerate}
        disabled={generating || !botConfigured}
        className="btn-primary text-sm"
      >
        {generating ? "Getting link…" : "Get my connect link"}
      </button>

      {!botConfigured && (
        <p className="text-xs text-slate-500">
          The bot isn&apos;t configured yet, so links can&apos;t be generated.
        </p>
      )}

      {result?.error && (
        <p className="text-sm text-red-600">{result.error}</p>
      )}

      {result?.ok && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          {result.link ? (
            <>
              <div className="text-xs text-slate-500">
                Your connect link (valid 15 minutes):
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={result.link}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-sm"
                >
                  Open in Telegram
                </a>
                <button
                  type="button"
                  onClick={() => copyLink(result.link!)}
                  className="btn-ghost text-xs"
                >
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
              </div>
              <div className="font-mono text-[11px] text-slate-500 break-all">
                {result.link}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-slate-500">
                Send this to the bot as{" "}
                <code className="bg-slate-100 px-1 rounded">
                  /start {result.code}
                </code>{" "}
                (valid 15 minutes):
              </div>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm bg-slate-100 px-2 py-1 rounded break-all">
                  {result.code}
                </code>
                <button
                  type="button"
                  onClick={() => copyLink(result.code!)}
                  className="btn-ghost text-xs"
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              </div>
            </>
          )}
          <div className="text-xs text-slate-500">
            Already tapped Start?{" "}
            <button
              type="button"
              onClick={() => router.refresh()}
              className="underline hover:text-brand-navy"
            >
              Refresh this page
            </button>{" "}
            to confirm.
          </div>
        </div>
      )}
    </div>
  );
}
